import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import {
	bootState,
	listDisks,
	listPools,
	type DiskEntry,
	type PoolEntry
} from '$lib/server/storage';

/**
 * Storage (§5.5). Read-mostly: pool health, per-member error counts, scrub
 * state, disks, boot pool.
 *
 * The boot pool comes from boot.get_state because pool.query does not return
 * it — verified on the box, where pool.query gives NAS only.
 *
 * Each read is allowed to fail alone: with a scoped API key a missing role
 * should cost one card, not the whole page.
 */
export const load: PageServerLoad = async () => {
	const status = serviceStatus();

	const base = {
		reachable: false,
		configured: status.configured,
		reason:
			status.error ??
			(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
		pools: [] as PoolEntry[],
		boot: null as PoolEntry | null,
		disks: [] as DiskEntry[],
		errors: {} as Record<string, string>
	};

	if (!status.ready) return base;

	const client = getClient();
	const errors: Record<string, string> = {};
	const fallible = async <T>(key: string, run: () => Promise<T>, empty: T): Promise<T> => {
		try {
			return await run();
		} catch (err) {
			errors[key] = (err as Error).message ?? 'failed';
			return empty;
		}
	};

	const [pools, boot, disks] = await Promise.all([
		fallible('pools', () => listPools(client), [] as PoolEntry[]),
		fallible('boot', () => bootState(client), null as PoolEntry | null),
		fallible('disks', () => listDisks(client), [] as DiskEntry[])
	]);

	return { reachable: true, configured: true, reason: '', pools, boot, disks, errors };
};
