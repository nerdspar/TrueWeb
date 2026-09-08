/**
 * Typed, signature-verified wrappers over the client (§ hard rule #2).
 *
 * Every method here has had its arguments and result shape confirmed against
 * https://api.truenas.com/v25.10/ — the exact version. Generic access remains
 * available via client.call/callJob/subscribe; this module is the curated,
 * verified surface M1 exercises.
 */
import type { TrueNasClient, AuthMe } from './client.ts';
import type { Job } from './jobs.ts';
import type { CollectionUpdate } from './protocol.ts';

/** app.query state enum, verified against api_methods_app.query.html. */
export type AppState = 'CRASHED' | 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'STOPPING';

export interface AppRecord {
	id: string;
	name: string;
	state: AppState;
	upgrade_available?: boolean;
	image_updates_available?: boolean;
	human_version?: string;
	custom_app?: boolean;
}

/** The trimmed field set the app list needs (§5.1). `select` keeps payloads small (§3.6). */
const APP_LIST_FIELDS = [
	'id',
	'name',
	'state',
	'upgrade_available',
	'image_updates_available',
	'human_version',
	'custom_app'
];

/** docker.status service states, verified against api_methods_docker.status.html. */
export type DockerServiceStatus =
	| 'PENDING'
	| 'RUNNING'
	| 'STOPPED'
	| 'INITIALIZING'
	| 'STOPPING'
	| 'UNCONFIGURED'
	| 'FAILED'
	| 'MIGRATING'
	| 'MIGRATION_FAILED';

export interface DockerStatus {
	status: DockerServiceStatus;
	description: string;
}

/** auth.me — the currently logged-in user. Verified: no params. */
export function whoami(client: TrueNasClient): Promise<AuthMe> {
	return client.call<AuthMe>('auth.me', []);
}

/** docker.status — Apps-service health for the §5.1 banner. Verified: no params. */
export function dockerStatus(client: TrueNasClient): Promise<DockerStatus> {
	return client.call<DockerStatus>('docker.status', []);
}

/** app.query — list apps with state. Verified: [filters, options]. */
export function listApps(client: TrueNasClient): Promise<AppRecord[]> {
	return client.call<AppRecord[]>('app.query', [[], { select: APP_LIST_FIELDS, order_by: ['name'] }]);
}

/** app.start — verified job, params [app_name]. */
export function startApp(client: TrueNasClient, name: string, onProgress?: (job: Job) => void) {
	return client.callJob('app.start', [name], onProgress);
}

/** app.stop — verified job, params [app_name]. */
export function stopApp(client: TrueNasClient, name: string, onProgress?: (job: Job) => void) {
	return client.callJob('app.stop', [name], onProgress);
}

/** app.redeploy — verified job, params [app_name]. */
export function redeployApp(client: TrueNasClient, name: string, onProgress?: (job: Job) => void) {
	return client.callJob('app.redeploy', [name], onProgress);
}

/* ── detail view (§5.1) ─────────────────────────────────────────────────── */

/** A container of an app. Verified: api_methods_app.container_ids.html. */
export interface ContainerInfo {
	id: string;
	service_name: string;
	image: string;
	state: 'running' | 'exited' | 'crashed' | 'created' | 'starting';
}

/** Per-app stats pushed by the app.stats event. Verified: api_events_app.stats.html. */
export interface AppStats {
	app_name: string;
	cpu_usage: number;
	memory: number;
	networks: { interface_name: string; rx_bytes: number; tx_bytes: number }[];
	blkio: { read: number; write: number };
}

/** One log line from app.container_log_follow. Verified: api_events_…html. */
export interface LogLine {
	data: string;
	timestamp: string | null;
}

/** The full app entry. Only fields we actually render are typed; the rest of
 *  the AppEntry is passed through untyped rather than guessed at. */
export interface AppDetail extends AppRecord {
	version?: string;
	notes?: string | null;
	metadata?: Record<string, unknown>;
	active_workloads?: Record<string, unknown>;
	portals?: Record<string, string>;
	version_details?: Record<string, unknown> | null;
}

/**
 * app.get_instance — verified params (id, options). For TrueNAS apps the id is
 * the release name; if a deployment ever diverges, fall back to a name query so
 * the detail page still resolves.
 */
export async function getApp(client: TrueNasClient, name: string): Promise<AppDetail | null> {
	try {
		return await client.call<AppDetail>('app.get_instance', [name]);
	} catch {
		const rows = await client.call<AppDetail[]>('app.query', [[['name', '=', name]]]);
		return rows?.[0] ?? null;
	}
}

/**
 * app.container_ids — verified params (app_name, {alive_only}).
 *
 * Defaults to including dead containers: when an app fails to come up, the
 * container that exited is the one holding the reason, and asking only for live
 * ones leaves nothing to look at.
 */
export function containerIds(
	client: TrueNasClient,
	name: string,
	aliveOnly = false
): Promise<Record<string, ContainerInfo>> {
	return client.call<Record<string, ContainerInfo>>('app.container_ids', [
		name,
		{ alive_only: aliveOnly }
	]);
}

/** A job's full detail, including whatever logs it managed to record. */
export interface JobDetail {
	id: number;
	method: string;
	state: string;
	error: string | null;
	exception: string | null;
	logs_path: string | null;
	logs_excerpt: string | null;
}

/**
 * One job by id, with its error and log excerpt. Note that an app lifecycle
 * failure records neither logs_path nor logs_excerpt — it points at
 * /var/log/app_lifecycle.log on the box instead, and that file is only
 * retrievable through the HTTP download endpoint, which this project doesn't
 * use (§3.1). The error and exception are what we can show.
 */
export async function jobDetail(client: TrueNasClient, id: number): Promise<JobDetail | null> {
	const rows = await client.call<JobDetail[]>('core.get_jobs', [
		[['id', '=', id]],
		{ select: ['id', 'method', 'state', 'error', 'exception', 'logs_path', 'logs_excerpt'] }
	]);
	return rows?.[0] ?? null;
}

/** app.upgrade_summary result. Verified: api_methods_app.upgrade_summary.html. */
export interface UpgradeSummary {
	latest_version?: string;
	latest_human_version?: string;
	upgrade_version?: string;
	upgrade_human_version?: string;
	available_versions_for_upgrade?: {
		version: string;
		human_version: string;
		changelog: string | null;
	}[];
}

/**
 * app.upgrade_summary — what an upgrade would change (§5.1: show this before
 * upgrading). Verified: (app_name, {app_version}); not a job.
 */
export function upgradeSummary(
	client: TrueNasClient,
	name: string,
	appVersion = 'latest'
): Promise<UpgradeSummary> {
	return client.call<UpgradeSummary>('app.upgrade_summary', [name, { app_version: appVersion }]);
}

/** app.rollback_versions — verified: (app_name) → version strings; not a job. */
export function rollbackVersions(client: TrueNasClient, name: string): Promise<string[]> {
	return client.call<string[]>('app.rollback_versions', [name]);
}

/** app.used_host_ips — verified: no params, returns {app_name: [ip, …]}. */
export function usedHostIps(client: TrueNasClient): Promise<Record<string, string[]>> {
	return client.call<Record<string, string[]>>('app.used_host_ips', []);
}

/** The app.stats event name. `interval` must be >= 2 seconds (verified). */
export function statsEvent(intervalSeconds?: number): string {
	return intervalSeconds ? `app.stats:${JSON.stringify({ interval: intervalSeconds })}` : 'app.stats';
}

/** The parameterized app.container_log_follow event name (verified shape). */
export function logFollowEvent(appName: string, containerId: string, tailLines = 500): string {
	return `app.container_log_follow:${JSON.stringify({
		app_name: appName,
		container_id: containerId,
		tail_lines: tailLines
	})}`;
}

/* ── compose deploy + path provisioning (§5.2 / §5.6) ────────────────────── */

/** filesystem.stat result. Verified: api_methods_filesystem.stat.html. */
export interface StatData {
	realpath: string;
	type: 'DIRECTORY' | 'FILE' | 'SYMLINK' | 'OTHER';
	uid: number;
	gid: number;
	mode: number;
	acl: boolean;
	is_mountpoint: boolean;
	user: string | null;
	group: string | null;
}

/**
 * filesystem.stat — verified: [path]. Resolves null when the path doesn't
 * exist: the middleware raises for a missing path, and "missing" is the normal,
 * expected answer here rather than a failure.
 */
export async function statPath(client: TrueNasClient, path: string): Promise<StatData | null> {
	try {
		return await client.call<StatData>('filesystem.stat', [path]);
	} catch {
		return null;
	}
}

/** One entry from filesystem.listdir. Verified: api_methods_filesystem.listdir.html. */
export interface DirEntry {
	name: string;
	path: string;
	type: 'DIRECTORY' | 'FILE' | 'SYMLINK' | 'OTHER';
	is_mountpoint: boolean;
	uid: number;
	gid: number;
}

/**
 * filesystem.listdir — verified: [path, filters, options], not a job. One
 * method covers the whole browse tree: /mnt lists the pools, a pool lists its
 * datasets and directories, and is_mountpoint says which is which.
 *
 * Filtered to directories and trimmed with `select`, because an unconstrained
 * listing returns a very large object graph (§3.6).
 */
export function listDir(client: TrueNasClient, path: string): Promise<DirEntry[]> {
	return client.call<DirEntry[]>('filesystem.listdir', [
		path,
		[['type', '=', 'DIRECTORY']],
		{ select: ['name', 'path', 'type', 'is_mountpoint', 'uid', 'gid'], order_by: ['name'] }
	]);
}

/**
 * pool.dataset.create — verified: [{name, …}] where name is the ZFS path
 * including the pool and no /mnt prefix. Not a job. Every property except one
 * is left to INHERIT from the parent (§5.2: this is provisioning, not a dataset
 * editor).
 *
 * aclmode DISCARD is the exception, and it is required rather than a
 * preference: with a parent whose acltype is POSIX or OFF — which is how this
 * box's app datasets are set up — the middleware rejects the create outright
 * with `pool_dataset_create.aclmode: Must be set to DISCARD when acltype is
 * POSIX or OFF`. It also happens to be exactly what §5.2 asks for: no ACLs on
 * datasets created this way, since host-path binds here are used without them.
 */
export function createDataset(client: TrueNasClient, datasetName: string): Promise<unknown> {
	return client.call('pool.dataset.create', [{ name: datasetName, aclmode: 'DISCARD' }]);
}

/** filesystem.mkdir — verified: [{path, mode}]. Not a job. */
export function mkdir(client: TrueNasClient, path: string): Promise<unknown> {
	return client.call('filesystem.mkdir', [{ path, mode: '755' }]);
}

/** filesystem.chown — verified: [{path, uid, gid, options}]. Is a job. */
export function chownPath(
	client: TrueNasClient,
	path: string,
	uid: number,
	gid: number,
	recursive = true
) {
	return client.callJob('filesystem.chown', [{ path, uid, gid, options: { recursive } }]);
}

/**
 * app.create for a custom (compose) app — verified: a single params object,
 * and a job. custom_app must be true, with the YAML in
 * custom_compose_config_string (§3.5).
 */
export function createCustomApp(client: TrueNasClient, appName: string, composeYaml: string) {
	return client.callJob('app.create', [
		{ app_name: appName, custom_app: true, custom_compose_config_string: composeYaml }
	]);
}

/** app.used_ports — verified: no params, every port in use by any app. */
export function usedPorts(client: TrueNasClient): Promise<number[]> {
	return client.call<number[]>('app.used_ports', []);
}

/** Subscribe to live app state changes (§3.4). */
export function watchApps(client: TrueNasClient, handler: (u: CollectionUpdate) => void): () => void {
	return client.subscribe('app.query', handler);
}

/** Subscribe to raw job progress for every mutating action on the box. */
export function watchJobs(client: TrueNasClient, handler: (u: CollectionUpdate) => void): () => void {
	return client.subscribe('core.get_jobs', handler);
}
