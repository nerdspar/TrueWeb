/**
 * Dashboard reads (§5.4). Every signature here was confirmed against
 * https://api.truenas.com/v25.10/ and none of them is a job.
 */
import type { TrueNasClient } from './truenas/client.ts';

// pool.query lives in storage.ts (§5.5) so there is one home for it; the
// dashboard needs it only to merge health onto the live capacity figures.
export { listPools, type PoolEntry } from './storage.ts';

/**
 * system.info — verified: no parameters; not a job.
 *
 * Preferred over webui.main.dashboard.sys_info, which carries the same hostname
 * / version / uptime but is documented as "designed to be exclusively consumed
 * by the webUI" — an explicit warning not to build on it. system.info also
 * carries loadavg, which §5.4 asks for and sys_info does not have.
 */
export type SystemInfo = {
	version: string;
	hostname: string;
	physmem: number;
	model: string;
	cores: number;
	physical_cores: number;
	/** 1 / 5 / 15 minute load averages. */
	loadavg: number[];
	uptime: string;
	uptime_seconds: number;
	timezone: string;
	ecc_memory: boolean;
	system_product: string | null;
};

export function systemInfo(client: TrueNasClient): Promise<SystemInfo> {
	return client.call<SystemInfo>('system.info', []);
}

/**
 * alert.list — verified: no parameters; not a job. Returns every alert,
 * dismissed ones included, so the caller filters.
 *
 * The Alert object carries both `uuid` and `id`. alert.dismiss documents its
 * parameter as `uuid` while its summary line says "Dismiss `id` alert", and the
 * docs do not resolve which the server wants — so both are kept here and the
 * dismiss path sends the one observed to work on a real alert.
 */
export type Alert = {
	uuid: string;
	id: string;
	klass: string;
	/** Free string in the docs (INFO / WARNING / ERROR / …), not a closed enum. */
	level: string;
	text: string;
	formatted: string | null;
	datetime: { $date: number } | string;
	last_occurrence: { $date: number } | string;
	dismissed: boolean;
	one_shot: boolean;
};

export function listAlerts(client: TrueNasClient): Promise<Alert[]> {
	return client.call<Alert[]>('alert.list', []);
}

/** alert.dismiss — verified: a single string id; not a job. Returns null. */
export function dismissAlert(client: TrueNasClient, uuid: string): Promise<null> {
	return client.call<null>('alert.dismiss', [uuid]);
}

/**
 * update.status — verified: no parameters; not a job.
 *
 * Display only. §5.4 is explicit that `update.run` is not exposed in v1, and it
 * sits in the allowlist's DENYLIST so it cannot be reached at all.
 */
export type UpdateStatus = {
	code: 'NORMAL' | 'ERROR';
	status: {
		current_version: { train: string; profile: string; matches_profile: boolean };
		new_version: { version: string; release_notes_url: string | null } | null;
	} | null;
	error: { errname: string; reason: string } | null;
};

export function updateStatus(client: TrueNasClient): Promise<UpdateStatus> {
	return client.call<UpdateStatus>('update.status', []);
}

/** core.get_jobs, narrowed to what's still in flight (§5.4). */
export type RunningJob = {
	id: number;
	method: string;
	state: string;
	description: string | null;
	progress: { percent?: number; description?: string | null } | null;
};

export function runningJobs(client: TrueNasClient): Promise<RunningJob[]> {
	return client.call<RunningJob[]>('core.get_jobs', [
		[['state', 'in', ['RUNNING', 'WAITING']]]
	]);
}
