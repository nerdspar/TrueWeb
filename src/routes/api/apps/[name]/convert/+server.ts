import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { convertToCustom } from '$lib/server/appconfig';
import { validateAppName } from '$lib/compose/inspect';
import { middlewareFailed } from '$lib/server/mwerror';

/**
 * Convert a catalog app to a custom app (§5.3, tier 2.5).
 *
 * Its own route rather than another lifecycle action: it is one-way, it ends
 * catalog updates for the app, and there is no undo anywhere in TrueNAS. The
 * typed name travels with the request for the same reason it does on delete —
 * the client-side gate must not be the only gate.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const name = params.name ?? '';
	if (validateAppName(name)) error(400, 'Invalid app name.');

	const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
	if (body.confirm !== name) {
		error(400, 'The typed name did not match. Nothing was converted.');
	}

	const client = getClient();
	try {
		const { id, done } = await convertToCustom(client, name);
		void done.catch(() => {});
		return json({ ok: true, jobId: id });
	} catch (err) {
		middlewareFailed(err, `Could not convert ${name}`);
	}
};
