import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { deleteApp } from '$lib/server/truenas/methods';
import { middlewareFailed } from '$lib/server/mwerror';

/**
 * Delete an app (tier 2.5 — the UI makes you type the name first).
 *
 * Its own route rather than another entry in the lifecycle action map: it takes
 * options that destroy data, and it deserves to be hard to reach by accident.
 * Stored data (ix-volumes) is kept unless `removeData` is explicitly true.
 */
const APP_NAME = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

export const POST: RequestHandler = async ({ params, request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const name = params.name ?? '';
	if (!APP_NAME.test(name)) error(400, 'Invalid app name.');

	const body = (await request.json().catch(() => ({}))) as {
		confirm?: unknown;
		removeImages?: unknown;
		removeData?: unknown;
		force?: unknown;
	};

	// The typed name travels with the request, so a stray POST can't delete an
	// app on its own — the client-side gate isn't the only gate.
	if (body.confirm !== name) {
		error(400, 'The typed name did not match. Nothing was deleted.');
	}

	const client = getClient();
	try {
		const { id, done } = await deleteApp(client, name, {
			removeImages: body.removeImages !== false,
			removeData: body.removeData === true,
			force: body.force === true
		});
		void done.catch(() => {});
		return json({ ok: true, jobId: id });
	} catch (err) {
		middlewareFailed(err, `Could not delete ${name}`);
	}
};
