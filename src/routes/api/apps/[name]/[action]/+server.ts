import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';

/**
 * App lifecycle actions (§5.1 row actions). Each maps to a verified job method;
 * the client's allowlist is the real gate (a method not on it never reaches the
 * socket). Jobs return a job id immediately — we hand that back and let the SSE
 * stream carry progress rather than holding the request open for a slow pull.
 */

const APP_NAME = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

const ACTIONS: Record<string, string> = {
	start: 'app.start',
	stop: 'app.stop',
	restart: 'app.redeploy',
	// Catalog version upgrade vs. pulling newer image digests — two different
	// operations (§3.5), so the caller picks explicitly.
	upgrade: 'app.upgrade',
	pull: 'app.pull_images',
	rollback: 'app.rollback'
};

export const POST: RequestHandler = async ({ params, request }) => {
	const name = params.name ?? '';
	const action = params.action ?? '';

	if (!APP_NAME.test(name)) error(400, 'Invalid app name.');
	const method = ACTIONS[action];
	if (!method) error(404, `Unknown action: ${action}`);
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const client = getClient();

	// Rollback is the one action that needs a payload: which version to go back
	// to. Verified v25.10: app.rollback(name, {app_version, rollback_snapshot}).
	let version = '';
	if (method === 'app.rollback') {
		const body = (await request.json().catch(() => ({}))) as { version?: unknown };
		version = typeof body.version === 'string' ? body.version : '';
		if (!version) error(400, 'A target version is required to roll back.');
	}

	// Verified v25.10: app.upgrade takes (name, {app_version}); app.pull_images
	// takes (name, {redeploy}); the rest take (name).
	const args =
		method === 'app.upgrade'
			? [name, { app_version: 'latest' }]
			: method === 'app.pull_images'
				? [name, { redeploy: true }]
				: method === 'app.rollback'
					? [name, { app_version: version, rollback_snapshot: true }]
					: [name];

	try {
		const { id, done } = await client.callJob(method, args);
		// The UI tracks completion via the SSE job stream; swallow the settled
		// promise here so a failed job isn't an unhandled rejection.
		void done.catch(() => {});
		return json({ ok: true, jobId: id, method });
	} catch (err) {
		error(502, (err as Error).message ?? 'Action failed.');
	}
};
