import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { listApps, type AppRecord } from '$lib/server/truenas/methods';

/**
 * Every app with an update waiting, for the bulk-update screen. Filtered in JS
 * off the verified app.query rather than guessing at an OR-filter shape.
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
			apps: [] as AppRecord[]
		};
	}

	const client = getClient();
	try {
		const all = await listApps(client);
		const apps = all.filter((a) => a.upgrade_available || a.image_updates_available);
		return { reachable: true, configured: true, reason: '', apps };
	} catch (err) {
		return {
			reachable: false,
			configured: true,
			reason: (err as Error).message ?? 'Failed to query apps.',
			apps: [] as AppRecord[]
		};
	}
};
