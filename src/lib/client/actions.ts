/** Shared client-side helpers for the app lifecycle actions (§5.1 / §6). */

export type Action = 'start' | 'stop' | 'restart' | 'upgrade' | 'pull' | 'rollback';

export const VERB: Record<Action, string> = {
	start: 'Start',
	stop: 'Stop',
	restart: 'Restart',
	upgrade: 'Update',
	pull: 'Update',
	rollback: 'Roll back'
};

export const GERUND: Record<Action, string> = {
	start: 'Starting',
	stop: 'Stopping',
	restart: 'Restarting',
	upgrade: 'Updating',
	pull: 'Updating',
	rollback: 'Rolling back'
};

/** Tier 1 actions go through on one tap; tier 2 needs a confirmation (§6). */
export const NEEDS_CONFIRM: Record<Action, boolean> = {
	start: false,
	restart: false,
	stop: true,
	upgrade: true,
	pull: true,
	rollback: true
};

/** What a tier-2 confirmation should say it's about to do. */
export function confirmMessage(action: Action): string {
	switch (action) {
		case 'stop':
			return 'The app’s containers will be stopped.';
		case 'upgrade':
			return 'Upgrade to the latest catalog version and redeploy.';
		case 'pull':
			return 'Pull the latest images and redeploy.';
		case 'rollback':
			return 'Roll back to the selected version. A snapshot is taken first.';
		default:
			return '';
	}
}

export interface UpdatableApp {
	custom_app?: boolean;
	upgrade_available?: boolean;
	image_updates_available?: boolean;
}

/**
 * Which update a given app actually needs (§3.5). `app.upgrade` is a catalog
 * concept — it must never be offered on a custom app as though it were the
 * same operation. Custom apps (and catalog apps with only newer image digests)
 * update via app.pull_images, which redeploys.
 */
export function resolveUpdateAction(app: UpdatableApp): Action | null {
	if (!app.custom_app && app.upgrade_available) return 'upgrade';
	if (app.image_updates_available || app.upgrade_available) return 'pull';
	return null;
}

/** Short label for the kind of update available, for the bulk list. */
export function updateKind(app: UpdatableApp): string {
	return resolveUpdateAction(app) === 'upgrade' ? 'new version' : 'new image';
}

/**
 * Kick off a lifecycle action. Resolves with the job id so the caller can
 * correlate progress from the event stream; throws with a readable message.
 */
export async function postAction(
	name: string,
	action: Action,
	payload?: Record<string, unknown>
): Promise<number | undefined> {
	const res = await fetch(`/api/apps/${encodeURIComponent(name)}/${action}`, {
		method: 'POST',
		...(payload
			? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
			: {})
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}) as { message?: string });
		throw new Error(body.message ?? `HTTP ${res.status}`);
	}
	const { jobId } = await res.json();
	return typeof jobId === 'number' ? jobId : undefined;
}

/**
 * Percentage for display. app.stats documents cpu_usage as an integer but the
 * middleware sends a float (e.g. 0.029762499999999997), which would otherwise
 * render raw and blow out the layout.
 */
export function formatPercent(n: number | undefined): string {
	if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
	if (n > 0 && n < 0.1) return '<0.1';
	return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/** Human-readable bytes, for memory and network counters. */
export function formatBytes(n: number | undefined): string {
	if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = n;
	let u = 0;
	while (v >= 1024 && u < units.length - 1) {
		v /= 1024;
		u++;
	}
	return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/**
 * "4 minutes ago" for a saved-version list. Intl.RelativeTimeFormat rather than
 * a hand-rolled table, and it falls back to the absolute date past a week,
 * where "13 days ago" stops being easier to read than the date itself.
 */
export function formatAgo(iso: string, now: Date = new Date()): string {
	const then = new Date(iso);
	if (Number.isNaN(then.getTime())) return '—';
	const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
	const past = Math.abs(seconds);
	if (past < 45) return 'just now';

	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	const steps: [Intl.RelativeTimeFormatUnit, number][] = [
		['minute', 60],
		['hour', 3600],
		['day', 86400]
	];
	if (past >= 7 * 86400) {
		return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	let unit: Intl.RelativeTimeFormatUnit = 'second';
	let divisor = 1;
	for (const [u, d] of steps) {
		if (past >= d) {
			unit = u;
			divisor = d;
		}
	}
	return rtf.format(Math.round(seconds / divisor), unit);
}

/** Throughput, for the dashboard's network and disk counters. */
export function formatRate(bytesPerSecond: number | undefined): string {
	if (typeof bytesPerSecond !== 'number' || !Number.isFinite(bytesPerSecond)) return '—';
	return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Uptime as something a person reads at a glance: the two largest units, so
 * "3d 4h" rather than "3 days, 4 hours, 12 minutes and 6 seconds".
 */
export function formatUptime(seconds: number | undefined): string {
	if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	if (m > 0) return `${m}m`;
	return `${Math.floor(seconds)}s`;
}
