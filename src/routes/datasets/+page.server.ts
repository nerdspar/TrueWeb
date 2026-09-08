import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { listDatasets } from '$lib/server/datasets';
import type { DatasetRow } from '$lib/datasets/props';

/** Datasets (§5.6) — the tree. One query, trimmed with select; see datasets.ts. */
export const load: PageServerLoad = async () => {
	const status = serviceStatus();

	if (!status.ready) {
		return {
			reachable: false,
			configured: status.configured,
			reason:
				status.error ??
				(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
			datasets: [] as DatasetRow[]
		};
	}

	const client = getClient();
	try {
		return {
			reachable: true,
			configured: true,
			reason: '',
			datasets: await listDatasets(client)
		};
	} catch (err) {
		return {
			reachable: false,
			configured: true,
			reason: (err as Error).message ?? 'Could not list datasets.',
			datasets: [] as DatasetRow[]
		};
	}
};
