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
	upgrade: 'app.upgrade'
};

export const POST: RequestHandler = async ({ params }) => {
	const name = params.name ?? '';
	const action = params.action ?? '';

	if (!APP_NAME.test(name)) error(400, 'Invalid app name.');
	const method = ACTIONS[action];
	if (!method) error(404, `Unknown action: ${action}`);
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const client = getClient();
	// app.upgrade takes (name, options); the rest take (name). Verified v25.10.
	const args = method === 'app.upgrade' ? [name, { app_version: 'latest' }] : [name];

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
