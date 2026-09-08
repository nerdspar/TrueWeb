import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { upgradeSummary, rollbackVersions } from '$lib/server/truenas/methods';

/**
 * Version info for the detail view (§5.1): what an upgrade would change, and
 * which versions this app can roll back to. Both are reads; neither is a job.
 * Fetched on demand rather than on page load — an upgrade summary hits the
 * catalog and isn't worth paying for on every open.
 */
export const GET: RequestHandler = async ({ params }) => {
	const name = params.name ?? '';
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const client = getClient();
	const [summary, rollback] = await Promise.all([
		upgradeSummary(client, name).catch(() => null),
		rollbackVersions(client, name).catch(() => [] as string[])
	]);

	return json({ summary, rollback });
};
