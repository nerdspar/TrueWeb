/** Shared client-side helpers for the app lifecycle actions (§5.1 / §6). */

export type Action = 'start' | 'stop' | 'restart' | 'upgrade';

export const VERB: Record<Action, string> = {
	start: 'Start',
	stop: 'Stop',
	restart: 'Restart',
	upgrade: 'Update'
};

export const GERUND: Record<Action, string> = {
	start: 'Starting',
	stop: 'Stopping',
	restart: 'Restarting',
	upgrade: 'Updating'
};

/** Tier 1 actions go through on one tap; tier 2 needs a confirmation (§6). */
export const NEEDS_CONFIRM: Record<Action, boolean> = {
	start: false,
	restart: false,
	stop: true,
	upgrade: true
};

/**
 * Kick off a lifecycle action. Resolves with the job id so the caller can
 * correlate progress from the event stream; throws with a readable message.
 */
export async function postAction(name: string, action: Action): Promise<number | undefined> {
	const res = await fetch(`/api/apps/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
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
