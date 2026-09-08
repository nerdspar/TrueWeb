/**
 * The TrueNAS middleware client (Milestone 1).
 *
 * One long-lived authenticated JSON-RPC-over-WebSocket session to
 * wss://<host>/api/current, with:
 *   - auth via auth.login_ex (mechanism API_KEY_PLAIN), verified with auth.me;
 *   - a single choke point (`send`) that runs the §6 allowlist on every call;
 *   - job correlation built in (JobRegistry + one core.get_jobs subscription);
 *   - subscription management that transparently re-subscribes on reconnect;
 *   - reconnect with capped, jittered backoff — a middleware restart is normal.
 *
 * This is the layer M2's backend imports. It intentionally exposes generic
 * `call` / `callJob` / `subscribe` primitives; typed, signature-verified
 * wrappers live in methods.ts.
 */
import { isIP } from 'node:net';
import WebSocket, { type RawData } from 'ws';
import { assertAllowed, isJobMethod } from './allowlist.ts';
import {
	AuthError,
	MiddlewareError,
	NotConnectedError,
	isResponse,
	type CollectionUpdate,
	type JsonRpcRequest
} from './protocol.ts';
import { JobRegistry, type Job } from './jobs.ts';
import { NULL_LOGGER, type Logger } from './log.ts';

export interface ClientConfig {
	host: string;
	apiKey: string;
	apiKeyUsername: string;
	verifyTls: boolean;
	/** Optional PEM CA bundle to trust (alternative to disabling verification). */
	ca?: string;
	/**
	 * TLS SNI server name. When unset, SNI is chosen automatically: none for an
	 * IP host, none when not verifying TLS (a LAN self-signed box serves its
	 * default vhost and nginx rejects an unrecognized SNI with alert 112), and
	 * the hostname otherwise so cert verification can match it. Set explicitly
	 * only when reaching the middleware through a proxy that needs a given name.
	 */
	tlsServername?: string;
}

export interface AuthMe {
	pw_name: string;
	pw_uid: number;
	pw_gid: number;
	privilege?: unknown;
	account_attributes?: string[];
	[k: string]: unknown;
}

export type SubscriptionHandler = (update: CollectionUpdate) => void;

const JOBS_EVENT = 'core.get_jobs';
const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 30_000;

interface Inflight {
	resolve: (value: unknown) => void;
	reject: (err: unknown) => void;
	method: string;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (v: T) => void;
	reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

export class TrueNasClient {
	private readonly cfg: ClientConfig;
	private readonly log: Logger;
	private readonly jobs = new JobRegistry();

	private ws?: WebSocket;
	private nextId = 1;
	private readonly inflight = new Map<number, Inflight>();

	/** Desired subscriptions: event → handlers. Survives reconnects. */
	private readonly subs = new Map<string, Set<SubscriptionHandler>>();
	/** Live subscription ids for the current connection: event → id_. */
	private readonly subIds = new Map<string, string>();

	private shouldRun = false;
	private ready = false;
	private reconnectAttempts = 0;
	private reconnectTimer?: ReturnType<typeof setTimeout>;
	private firstReady?: Deferred<AuthMe>;
	private me?: AuthMe;
	private sniHintShown = false;

	private readonly jobsHandler: SubscriptionHandler = (u) => this.onJobUpdate(u);

	constructor(cfg: ClientConfig, log: Logger = NULL_LOGGER) {
		this.cfg = cfg;
		this.log = log;
		// The internal job subscription is always part of the desired set.
		this.subs.set(JOBS_EVENT, new Set([this.jobsHandler]));
	}

	get url(): string {
		return `wss://${this.cfg.host}/api/current`;
	}

	get identity(): AuthMe | undefined {
		return this.me;
	}

	/** Connect, authenticate, and resubscribe. Resolves with auth.me on ready. */
	connect(): Promise<AuthMe> {
		this.shouldRun = true;
		this.firstReady ??= deferred<AuthMe>();
		this.open();
		return this.firstReady.promise;
	}

	/** Shut down for good: no further reconnects; best-effort unsubscribe. */
	async close(): Promise<void> {
		this.shouldRun = false;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		const ws = this.ws;
		if (ws && ws.readyState === WebSocket.OPEN) {
			for (const id of this.subIds.values()) {
				try {
					await this.send('core.unsubscribe', [id]);
				} catch {
					/* going away anyway */
				}
			}
			ws.close(1000, 'client shutdown');
		} else {
			ws?.terminate();
		}
		this.ready = false;
	}

	// ── public call surface ────────────────────────────────────────────────

	/** Call a method and await its result. Gated by the §6 allowlist. */
	call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
		return this.send(method, params) as Promise<T>;
	}

	/**
	 * Invoke a job method. Resolves once the call returns the job id, giving back
	 * the id and a `done` promise that settles on job completion. `onProgress`
	 * fires for every intermediate core.get_jobs update.
	 */
	async callJob(
		method: string,
		params: unknown[] = [],
		onProgress?: (job: Job) => void
	): Promise<{ id: number; done: Promise<Job> }> {
		if (!isJobMethod(method)) {
			throw new Error(`${method} is not a job method (allowlist says otherwise)`);
		}
		const id = (await this.send(method, params)) as number;
		if (typeof id !== 'number' || !Number.isFinite(id)) {
			throw new Error(`expected a job id from ${method}, received ${JSON.stringify(id)}`);
		}
		const done = this.jobs.register(id, { method, onProgress });
		// Close the missed-event window (fast job, or one begun during a blip).
		void this.seedJob(id);
		return { id, done };
	}

	/**
	 * Subscribe to an event (§3.4). The handler is invoked for every matching
	 * collection_update. The returned function unsubscribes. Subscriptions are
	 * restored automatically across reconnects.
	 */
	subscribe(event: string, handler: SubscriptionHandler): () => void {
		assertAllowed(event);
		let set = this.subs.get(event);
		const firstForEvent = !set || set.size === 0;
		if (!set) {
			set = new Set();
			this.subs.set(event, set);
		}
		set.add(handler);
		if (this.ready && firstForEvent) {
			void this.issueSubscribe(event);
		}
		return () => this.removeHandler(event, handler);
	}

	// ── socket lifecycle ───────────────────────────────────────────────────

	/**
	 * Decide the SNI name. Returning '' means "send no SNI" (ws honours an empty
	 * string); returning undefined lets ws derive it from the host. See the
	 * ClientConfig.tlsServername doc for why we suppress it in the common cases.
	 */
	private resolveServername(): string | undefined {
		if (this.cfg.tlsServername !== undefined) return this.cfg.tlsServername;
		const host = this.cfg.host.split(':')[0] ?? this.cfg.host;
		if (isIP(host)) return '';
		if (!this.cfg.verifyTls) return '';
		return undefined;
	}

	private open(): void {
		const servername = this.resolveServername();
		this.log.info(
			`connecting to ${this.url} (verify_tls=${this.cfg.verifyTls}, sni=${servername === '' ? 'none' : (servername ?? 'auto')})`
		);
		const ws = new WebSocket(this.url, {
			rejectUnauthorized: this.cfg.verifyTls,
			ca: this.cfg.ca,
			...(servername !== undefined ? { servername } : {})
		});
		this.ws = ws;
		ws.on('open', () => {
			this.onOpen().catch((err) => this.fatalOrRetry(err));
		});
		ws.on('message', (data) => this.onMessage(data));
		ws.on('close', (code, reason) => this.onClose(code, reason.toString()));
		ws.on('error', (err) => {
			this.log.warn(`socket error: ${err.message}`);
			if (!this.sniHintShown && /unrecognized name|alert number 112/i.test(err.message)) {
				this.sniHintShown = true;
				this.log.warn(
					'the server rejected the TLS handshake for a missing/unrecognized SNI. ' +
						'It is fronted by a proxy or an nginx that requires a known server name. ' +
						'Set TRUENAS_TLS_SERVERNAME to the hostname the box answers to (e.g. its FQDN).'
				);
			}
		});
	}

	private async onOpen(): Promise<void> {
		this.log.info(`connected to ${this.url}`);
		this.me = await this.authenticate();
		await this.resubscribe();
		this.ready = true;
		this.reconnectAttempts = 0;
		this.log.info(`ready — authenticated as ${this.me.pw_name} (uid ${this.me.pw_uid})`);
		this.firstReady?.resolve(this.me);
	}

	private async authenticate(): Promise<AuthMe> {
		// The api_key travels only inside these params, which are never logged.
		const res = (await this.send('auth.login_ex', [
			{
				mechanism: 'API_KEY_PLAIN',
				username: this.cfg.apiKeyUsername,
				api_key: this.cfg.apiKey,
				login_options: { user_info: true }
			}
		])) as { response_type?: string } | null;

		const responseType = res?.response_type ?? 'UNKNOWN';
		if (responseType !== 'SUCCESS') {
			// Fail loudly and visibly (§7). Do not proceed unauthenticated.
			throw new AuthError(responseType);
		}
		return (await this.send('auth.me', [])) as AuthMe;
	}

	private onClose(code: number, reason: string): void {
		this.ready = false;
		this.subIds.clear();
		const err = new NotConnectedError(`socket closed (${code}${reason ? ` ${reason}` : ''})`);
		for (const pending of this.inflight.values()) pending.reject(err);
		this.inflight.clear();
		if (!this.shouldRun) {
			this.log.info('closed');
			return;
		}
		this.scheduleReconnect();
	}

	private fatalOrRetry(err: unknown): void {
		// A rejected key is not recoverable by retrying: surface it and stop.
		if (err instanceof AuthError) {
			this.log.error(String((err as Error).message));
			this.shouldRun = false;
			this.firstReady?.reject(err);
			this.ws?.close(1000, 'auth failed');
			return;
		}
		this.log.warn(`connection setup failed: ${String((err as Error)?.message ?? err)}`);
		this.ws?.terminate();
	}

	private scheduleReconnect(): void {
		const attempt = this.reconnectAttempts++;
		const backoff = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** attempt);
		const jitter = Math.random() * Math.min(backoff, 1000);
		const wait = Math.round(backoff + jitter);
		this.log.warn(`reconnecting in ${wait}ms (attempt ${attempt + 1})`);
		this.reconnectTimer = setTimeout(() => {
			if (this.shouldRun) this.open();
		}, wait);
	}

	// ── message handling ─────────────────────────────────────────────────────

	private onMessage(data: RawData): void {
		let msg: unknown;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			this.log.warn('dropped a non-JSON frame');
			return;
		}

		if (isResponse(msg)) {
			const pending = this.inflight.get(msg.id);
			if (!pending) return;
			this.inflight.delete(msg.id);
			if ('error' in msg && msg.error) pending.reject(new MiddlewareError(msg.error, pending.method));
			else pending.resolve((msg as { result: unknown }).result);
			return;
		}

		if (typeof msg === 'object' && msg !== null && 'method' in msg) {
			const notif = msg as { method: string; params?: unknown };
			if (notif.method === 'collection_update') {
				this.dispatch(notif.params as CollectionUpdate);
			} else if (notif.method === 'notify_unsubscribed') {
				const p = notif.params as { collection?: string; error?: unknown };
				this.log.warn(`unsubscribed from ${p.collection}: ${JSON.stringify(p.error)}`);
			}
		}
	}

	private dispatch(update: CollectionUpdate): void {
		const handlers = this.subs.get(update.collection);
		if (!handlers) return;
		for (const handler of handlers) {
			try {
				handler(update);
			} catch (e) {
				this.log.warn(`subscription handler for ${update.collection} threw: ${String(e)}`);
			}
		}
	}

	private onJobUpdate(update: CollectionUpdate): void {
		const fields = update.fields as Partial<Job> | undefined;
		const idFromFields = typeof fields?.id === 'number' ? fields.id : undefined;
		const idFromEnvelope = typeof update.id === 'number' ? update.id : Number(update.id);
		const id = idFromFields ?? idFromEnvelope;
		if (!Number.isFinite(id)) return;
		this.jobs.ingest({ ...(fields ?? {}), id } as Job);
	}

	// ── subscriptions ─────────────────────────────────────────────────────────

	private async resubscribe(): Promise<void> {
		this.subIds.clear();
		for (const [event, handlers] of this.subs) {
			if (handlers.size === 0) continue;
			await this.issueSubscribe(event);
		}
		// Re-seed jobs still in flight so any that finished during the outage settle.
		for (const id of this.jobs.pendingIds()) void this.seedJob(id);
	}

	private async issueSubscribe(event: string): Promise<void> {
		try {
			const id = (await this.send('core.subscribe', [event])) as string;
			this.subIds.set(event, id);
			this.log.info(`subscribed ${event} (${id})`);
		} catch (err) {
			this.log.warn(`subscribe ${event} failed: ${String((err as Error)?.message ?? err)}`);
		}
	}

	private removeHandler(event: string, handler: SubscriptionHandler): void {
		const set = this.subs.get(event);
		if (!set) return;
		set.delete(handler);
		if (set.size > 0) return;
		// Never tear down the internal jobs subscription.
		if (event === JOBS_EVENT) return;
		this.subs.delete(event);
		const id = this.subIds.get(event);
		if (id && this.ready) {
			this.subIds.delete(event);
			void this.send('core.unsubscribe', [id]).catch(() => {});
		}
	}

	private async seedJob(id: number): Promise<void> {
		try {
			const rows = await this.call<Job[]>('core.get_jobs', [[['id', '=', id]]]);
			if (Array.isArray(rows) && rows[0]) this.jobs.ingest(rows[0]);
		} catch (err) {
			this.log.debug(`seed of job ${id} failed: ${String((err as Error)?.message ?? err)}`);
		}
	}

	// ── the single choke point ─────────────────────────────────────────────

	private send(method: string, params: unknown[]): Promise<unknown> {
		// Hard rule #4: the allowlist is enforced before anything hits the socket.
		assertAllowed(method);
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new NotConnectedError(`cannot call ${method}: socket not connected`));
		}
		const id = this.nextId++;
		const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
		return new Promise((resolve, reject) => {
			this.inflight.set(id, { resolve, reject, method });
			// Log the method and id only — never params (the api_key lives there).
			this.log.debug(`→ #${id} ${method}`);
			ws.send(JSON.stringify(req), (err) => {
				if (err) {
					this.inflight.delete(id);
					reject(err);
				}
			});
		});
	}
}
