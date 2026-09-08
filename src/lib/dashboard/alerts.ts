/**
 * Presenting alerts (§5.4).
 *
 * Two things about the middleware's Alert object that are easy to get wrong:
 *
 * 1. `text` is the *template*, not the message. A real alert off the box reads
 *    "Updates are available for %(count)d application%(plural)s: %(apps)s".
 *    `formatted` is the one with the values substituted in. So prefer
 *    `formatted` and keep `text` only as a fallback.
 * 2. `datetime` arrives as `{"$date": 1788897546000}` — epoch milliseconds in a
 *    wrapper — not as an ISO string, despite the docs typing it date-time.
 */

export type AlertLike = {
	level?: string;
	text?: string | null;
	formatted?: string | null;
	datetime?: { $date: number } | string | null;
};

/**
 * The message to show. `formatted` is documented as possibly containing HTML,
 * so tags are stripped for display — never rendered. Interpolating alert text
 * as HTML would let anything that can raise an alert inject markup.
 */
export function alertMessage(alert: AlertLike): string {
	const raw = (alert.formatted ?? '').trim() || (alert.text ?? '').trim();
	return raw
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Normalise either date shape to an ISO string, or '' when unusable. */
export function alertIso(value: AlertLike['datetime']): string {
	if (!value) return '';
	if (typeof value === 'string') {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
	}
	if (typeof value.$date === 'number') {
		const parsed = new Date(value.$date);
		return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
	}
	return '';
}

export type AlertTone = 'info' | 'warn' | 'danger';

/**
 * The docs describe `level` as a free string with examples rather than a closed
 * enum, so this maps what's known and treats anything unrecognised as a warning
 * — an unknown level is more likely to matter than not.
 */
export function alertTone(level: string | undefined): AlertTone {
	switch ((level ?? '').toUpperCase()) {
		case 'INFO':
		case 'NOTICE':
			return 'info';
		case 'WARNING':
			return 'warn';
		case 'ERROR':
		case 'CRITICAL':
		case 'ALERT':
		case 'EMERGENCY':
			return 'danger';
		default:
			return 'warn';
	}
}

/** Most serious first, then newest — the order you'd want to read them in. */
export function sortAlerts<T extends AlertLike>(alerts: T[]): T[] {
	const rank: Record<AlertTone, number> = { danger: 0, warn: 1, info: 2 };
	return [...alerts].sort((a, b) => {
		const byTone = rank[alertTone(a.level)] - rank[alertTone(b.level)];
		if (byTone !== 0) return byTone;
		return (
			new Date(alertIso(b.datetime) || 0).getTime() -
			new Date(alertIso(a.datetime) || 0).getTime()
		);
	});
}
