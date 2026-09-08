import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { listApps, dockerStatus, type AppRecord, type DockerStatus } from '$lib/server/truenas/methods';

/**
 * Apps tab (§5.1). When the middleware isn't reachable yet, return a clear
 * not-reachable state rather than an empty list that looks like data loss.
 */
export const load: PageServerLoad = async () => {
	const status = serviceStatus();

	if (!status.ready) {
		return {
			reachable: false,
			configured: status.configured,
			reason:
				status.error ??
				(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
			apps: [] as AppRecord[],
			docker: null as DockerStatus | null,
			pendingUpdates: 0
		};
	}

	const client = getClient();
	try {
		const [apps, docker] = await Promise.all([
			listApps(client),
			dockerStatus(client).catch(() => null)
		]);
		const pendingUpdates = apps.filter(
			(a) => a.upgrade_available || a.image_updates_available
		).length;
		return { reachable: true, configured: true, reason: '', apps, docker, pendingUpdates };
	} catch (err) {
		return {
			reachable: false,
			configured: true,
			reason: (err as Error).message ?? 'Failed to query apps.',
			apps: [] as AppRecord[],
			docker: null as DockerStatus | null,
			pendingUpdates: 0
		};
	}
};
