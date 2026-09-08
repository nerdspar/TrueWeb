import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import type { CollectionUpdate } from '$lib/server/truenas';

/**
 * Server-sent events (§4.3). One stream per browser, all fed from the single
 * middleware subscription the backend already holds — no per-client sockets.
 * Events:
 *   hello    { ready }              once, on connect
 *   app      { msg, id, fields }    an app.query change (state, updates, …)
 *   job      { id, method, state, progress }   a core.get_jobs change
 *   realtime { ... }               system CPU/memory/network, dashboard only
 *
 * reporting.realtime is opt-in via ?realtime=1 because it is a firehose that
 * arrives every second whether anyone is looking or not. The Apps tab has no
 * use for it, and the client ref-counts subscriptions — so gating it here means
 * the middleware is not asked for it at all unless a dashboard is open.
 */
export const GET: RequestHandler = async ({ url }) => {
	const wantRealtime = url.searchParams.get('realtime') === '1';
	const encoder = new TextEncoder();
	let closed = false;
	let unsubApp: (() => void) | undefined;
	let unsubJob: (() => void) | undefined;
	let unsubRealtime: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					teardown();
				}
			};

			send('hello', { ready: serviceStatus().ready });

			// If configured, wire the fan-out. subscribe() tolerates a not-yet-ready
			// client — it registers now and the middleware subscription is issued
			// (or restored) when the socket is ready.
			if (serviceStatus().configured) {
				const client = getClient();
				unsubApp = client.subscribe('app.query', (u: CollectionUpdate) => {
					send('app', { msg: u.msg, id: u.id, fields: u.fields });
				});
				unsubJob = client.subscribe('core.get_jobs', (u: CollectionUpdate) => {
					const j = (u.fields ?? {}) as {
						id?: number;
						method?: string;
						state?: string;
						error?: string | null;
						progress?: { percent?: number; description?: string | null };
					};
					send('job', {
						id: j.id ?? u.id,
						method: j.method,
						state: j.state,
						error: j.error ?? null,
						progress: j.progress
					});
				});

				if (wantRealtime) {
					unsubRealtime = client.subscribe('reporting.realtime', (u: CollectionUpdate) => {
						send('realtime', u.fields ?? {});
					});
				}
			}

			// Comment heartbeat keeps intermediaries from closing an idle stream.
			heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					teardown();
				}
			}, 25_000);
			heartbeat.unref?.();

			function teardown() {
				if (closed) return;
				closed = true;
				unsubApp?.();
				unsubJob?.();
				unsubRealtime?.();
				if (heartbeat) clearInterval(heartbeat);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			}
		},
		cancel() {
			closed = true;
			unsubApp?.();
			unsubJob?.();
			unsubRealtime?.();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// Ask nginx / NPM not to buffer the stream.
			'x-accel-buffering': 'no'
		}
	});
};
