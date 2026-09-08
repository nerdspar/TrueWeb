import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import {
	getApp,
	containerIds,
	usedHostIps,
	type AppDetail,
	type ContainerInfo
} from '$lib/server/truenas/methods';

/**
 * App detail (§5.1). Everything here comes from methods verified against
 * v25.10: app.get_instance, app.container_ids, app.used_host_ips. Live CPU/
 * memory and the log tail arrive over the per-app SSE stream.
 */
export const load: PageServerLoad = async ({ params }) => {
	const name = params.name;
	const status = serviceStatus();

	const unreachable = {
		name,
		reachable: false,
		configured: status.configured,
		reason:
			status.error ??
			(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
		app: null as AppDetail | null,
		containers: [] as ContainerInfo[],
		hostIps: [] as string[]
	};

	if (!status.ready) return unreachable;

	const client = getClient();
	try {
		const app = await getApp(client, name);
		if (!app) {
			return { ...unreachable, reachable: true, configured: true, reason: 'not-found' };
		}

		// Neither of these should sink the page if it fails.
		const [containers, ips] = await Promise.all([
			// alive_only false: a container that came up and died is exactly the
			// one worth reading logs from.
			containerIds(client, name, false).catch(() => ({}) as Record<string, ContainerInfo>),
			usedHostIps(client).catch(() => ({}) as Record<string, string[]>)
		]);

		return {
			name,
			reachable: true,
			configured: true,
			reason: '',
			app,
			containers: Object.values(containers),
			hostIps: ips[name] ?? []
		};
	} catch (err) {
		return { ...unreachable, configured: true, reason: (err as Error).message ?? 'Failed to load app.' };
	}
};
