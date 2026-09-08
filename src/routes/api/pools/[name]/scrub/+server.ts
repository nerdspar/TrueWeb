import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { scrubPool, type ScrubAction } from '$lib/server/storage';
import { middlewareFailed } from '$lib/server/mwerror';

/** A ZFS pool name. Deliberately strict — this goes to the middleware as-is. */
const POOL_NAME = /^[A-Za-z][-A-Za-z0-9_.:]*$/;
const ACTIONS: ScrubAction[] = ['START', 'STOP', 'PAUSE'];

/**
 * Start, stop or pause a scrub (§5.5, tier 2 — the UI confirms first).
 *
 * §5.5 names pool.scrub.run; see storage.ts for why this calls
 * pool.scrub.scrub instead. Nothing here can create, expand, replace, offline
 * or export a pool: those are in the allowlist's DENYLIST and unreachable.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const name = params.name ?? '';
	if (!POOL_NAME.test(name)) error(400, 'Invalid pool name.');

	const body = (await request.json().catch(() => ({}))) as { action?: unknown };
	const action = body.action;
	if (typeof action !== 'string' || !ACTIONS.includes(action as ScrubAction)) {
		error(400, 'Action must be START, STOP or PAUSE.');
	}

	const client = getClient();
	try {
		const { id, done } = await scrubPool(client, name, action as ScrubAction);
		void done.catch(() => {});
		return json({ ok: true, jobId: id });
	} catch (err) {
		middlewareFailed(err, `Could not ${action.toLowerCase()} the scrub on ${name}`);
	}
};
