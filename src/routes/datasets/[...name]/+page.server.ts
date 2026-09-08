import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { getDataset, type DatasetDetail } from '$lib/server/datasets';
import { statPath, type StatData } from '$lib/server/truenas/methods';

/** A ZFS dataset path: pool/child/grandchild. */
const DATASET_NAME = /^[A-Za-z][-A-Za-z0-9_.:]*(\/[-A-Za-z0-9_.: ]+)*$/;

/**
 * One dataset (§5.6).
 *
 * Ownership and mode are loaded alongside the ZFS properties because §5.6 is
 * blunt about why: "Getting this wrong is the single most common reason a
 * freshly deployed container fails, so make the current state visible rather
 * than something you have to go find out."
 */
export const load: PageServerLoad = async ({ params }) => {
	const name = params.name ?? '';
	if (!DATASET_NAME.test(name)) error(400, 'Invalid dataset name.');

	const status = serviceStatus();
	if (!status.ready) {
		return {
			name,
			reachable: false,
			configured: status.configured,
			reason:
				status.error ??
				(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
			dataset: null as DatasetDetail | null,
			stat: null as StatData | null
		};
	}

	const client = getClient();
	try {
		const dataset = await getDataset(client, name);
		if (!dataset) {
			return {
				name,
				reachable: true,
				configured: true,
				reason: 'not-found',
				dataset: null,
				stat: null
			};
		}
		// A locked dataset isn't mounted, so stat would fail — don't ask.
		const stat =
			dataset.mountpoint && !dataset.locked
				? await statPath(client, dataset.mountpoint).catch(() => null)
				: null;
		return { name, reachable: true, configured: true, reason: '', dataset, stat };
	} catch (err) {
		return {
			name,
			reachable: false,
			configured: true,
			reason: (err as Error).message ?? 'Could not read that dataset.',
			dataset: null,
			stat: null
		};
	}
};
