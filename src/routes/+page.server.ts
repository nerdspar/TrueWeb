import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import {
	listAlerts,
	listPools,
	runningJobs,
	systemInfo,
	updateStatus,
	type Alert,
	type PoolEntry,
	type RunningJob,
	type SystemInfo,
	type UpdateStatus
} from '$lib/server/dashboard';

/**
 * Dashboard (§5.4).
 *
 * The live half — CPU, memory, network, disk I/O, pool capacity — arrives over
 * reporting.realtime and is not fetched here. What this loads is the half that
 * the realtime feed has no equivalent for: pool *health*, alerts, system
 * identity, and whether an OS update is waiting.
 *
 * Each call is allowed to fail on its own. A dashboard that renders nothing
 * because one of five reads was refused is worse than one that renders four
 * cards and says which one is missing — and with a scoped API key, a single
 * missing role is the likely reason.
 */
export const load: PageServerLoad = async () => {
	const status = serviceStatus();

	const base = {
		reachable: false,
		configured: status.configured,
		reason:
			status.error ??
			(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
		system: null as SystemInfo | null,
		pools: [] as PoolEntry[],
		alerts: [] as Alert[],
		update: null as UpdateStatus | null,
		jobs: [] as RunningJob[],
		/** Per-section failures, so the UI can say what it couldn't read. */
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

	const [system, pools, alerts, update, jobs] = await Promise.all([
		fallible('system', () => systemInfo(client), null as SystemInfo | null),
		fallible('pools', () => listPools(client), [] as PoolEntry[]),
		fallible('alerts', () => listAlerts(client), [] as Alert[]),
		fallible('update', () => updateStatus(client), null as UpdateStatus | null),
		fallible('jobs', () => runningJobs(client), [] as RunningJob[])
	]);

	return {
		reachable: true,
		configured: true,
		reason: '',
		system,
		pools,
		// Dismissed alerts are not "active" (§5.4), so they don't ship to the client.
		alerts: alerts.filter((a) => !a.dismissed),
		update,
		jobs,
		errors
	};
};
