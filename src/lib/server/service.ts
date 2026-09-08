/**
 * The process-wide TrueNAS client singleton (§4) and its SvelteKit wiring.
 *
 * One long-lived authenticated socket, shared across every request and every
 * connected browser — not one per page load. Created from env on first use,
 * connected once at server start (via hooks.server.ts). A missing/invalid
 * config or an unreachable box is surfaced through `serviceStatus()` so routes
 * render a clear state instead of crashing or hanging (§5.1).
 *
 * This module is app glue (it depends on SvelteKit's $app/environment); the
 * client layer under ./truenas stays framework-free so it can be reused and
 * type-checked on its own.
 */
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { TrueNasClient } from './truenas/client.ts';
import { configFrom } from './truenas/env.ts';
import { makeLogger } from './truenas/log.ts';

let client: TrueNasClient | null = null;
let configError: string | null = null;
let started = false;

function ensureClient(): TrueNasClient | null {
	if (client || configError) return client;
	try {
		client = new TrueNasClient(configFrom(env), makeLogger('trueweb'));
	} catch (err) {
		configError = (err as Error).message;
		client = null;
	}
	return client;
}

/** Begin connecting the singleton. Idempotent; safe to call at server start. */
export function startClient(): void {
	if (building || started) return;
	started = true;
	const c = ensureClient();
	if (!c) {
		console.error(`[trueweb] TrueNAS client not configured: ${configError}`);
		return;
	}
	// connect() resolves on first ready and only rejects on a fatal auth error;
	// an unreachable box leaves it retrying, which serviceStatus() reflects.
	c.connect().catch((err) => {
		console.error(`[trueweb] middleware connection failed: ${(err as Error)?.message ?? err}`);
	});
}

/** The connected client. Throws if unconfigured — callers that tolerate an
 *  unreachable box should check serviceStatus() first. */
export function getClient(): TrueNasClient {
	const c = ensureClient();
	if (!c) throw new Error(configError ?? 'TrueNAS client not configured');
	return c;
}

export interface ServiceStatus {
	/** Env is present and a client was constructed. */
	configured: boolean;
	/** Socket is connected + authenticated + subscribed. */
	ready: boolean;
	/** Config error message, if construction failed. */
	error: string | null;
}

export function serviceStatus(): ServiceStatus {
	const c = ensureClient();
	return { configured: !!c, ready: !!c && c.connected, error: configError };
}
