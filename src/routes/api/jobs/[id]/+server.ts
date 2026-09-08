import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { jobDetail } from '$lib/server/truenas/methods';
import { middlewareFailed } from '$lib/server/mwerror';

/**
 * One job's detail, for showing why something failed. Fetched on demand so a
 * failure panel can fill itself in even if the SSE event was missed (a reload,
 * a reconnect), rather than leaving the reason to a toast that has gone.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 0) error(400, 'Invalid job id.');

	const client = getClient();
	try {
		const job = await jobDetail(client, id);
		if (!job) error(404, `No job ${id}.`);
		return json(job);
	} catch (err) {
		middlewareFailed(err, `Could not read job ${id}`);
	}
};
