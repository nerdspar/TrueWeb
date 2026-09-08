import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { appConfig, configToYaml, updateCustomApp } from '$lib/server/appconfig';
import { history } from '$lib/server/history';
import { validateAppName, inspectCompose } from '$lib/compose/inspect';
import { middlewareFailed } from '$lib/server/mwerror';

/**
 * Save a custom app's compose (§5.3). app.update is a job and it redeploys, so
 * the job id goes back for the SSE stream to follow.
 *
 * The YAML is re-validated here: the client checks before sending, but a
 * request body is never taken on trust.
 *
 * The compose being replaced is recorded first, so a bad edit can be undone
 * (§5.3). It's read back from the middleware rather than taken from the request:
 * what the client thinks was live is a guess, and the point of the record is to
 * be the state that actually was.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const name = params.name ?? '';
	if (validateAppName(name)) error(400, 'Invalid app name.');

	const body = (await request.json().catch(() => ({}))) as { compose?: unknown };
	const compose = typeof body.compose === 'string' ? body.compose : '';

	const inspection = inspectCompose(compose);
	if (!inspection.ok) error(400, inspection.error?.message ?? 'The compose file is not valid.');

	const client = getClient();
	try {
		// Best-effort: failing to snapshot must not block the save the user asked
		// for. Losing an undo is worse than not having one, but refusing to save
		// because of it would be worse still.
		try {
			history.record(name, configToYaml(await appConfig(client, name)));
		} catch {
			/* no history for this save */
		}

		const { id, done } = await updateCustomApp(client, name, compose);
		void done.catch(() => {});
		return json({ ok: true, jobId: id });
	} catch (err) {
		middlewareFailed(err, `Could not update ${name}`);
	}
};
