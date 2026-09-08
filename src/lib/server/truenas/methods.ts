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
	human_version?: string;
	custom_app?: boolean;
}

/** The trimmed field set the app list needs (§5.1). `select` keeps payloads small (§3.6). */
const APP_LIST_FIELDS = ['id', 'name', 'state', 'upgrade_available', 'human_version', 'custom_app'];

/** auth.me — the currently logged-in user. Verified: no params. */
export function whoami(client: TrueNasClient): Promise<AuthMe> {
	return client.call<AuthMe>('auth.me', []);
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

/** Subscribe to live app state changes (§3.4). */
export function watchApps(client: TrueNasClient, handler: (u: CollectionUpdate) => void): () => void {
	return client.subscribe('app.query', handler);
}

/** Subscribe to raw job progress for every mutating action on the box. */
export function watchJobs(client: TrueNasClient, handler: (u: CollectionUpdate) => void): () => void {
	return client.subscribe('core.get_jobs', handler);
}
