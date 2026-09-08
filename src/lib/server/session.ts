/**
 * Single shared-passcode gate (§7). A speed bump against someone picking up an
 * unlocked phone, not a real authz system — and documented as such.
 *
 * The passcode is verified against a bcrypt hash held in env (never plaintext,
 * never in the repo). A successful check issues an HMAC-signed, time-limited
 * cookie token; the token machinery and login throttle are Seek's, which have
 * already been through the "exposed through a tunnel" threat model.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PASSCODE_HASH, SESSION_SECRET, gateEnabled } from './config.ts';

export const COOKIE = 'trueweb_session';

/** Matches the cookie Max-Age; also enforced on the token so a copied cookie
 *  cannot outlive it. */
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function secret(): string {
	const s = SESSION_SECRET();
	if (!s) throw new Error('TRUEWEB_SESSION_SECRET is required when TRUEWEB_PASSCODE_HASH is set.');
	return s;
}

export { gateEnabled };

export function issue(): string {
	const issued = String(Date.now());
	const mac = createHmac('sha256', secret()).update(issued).digest('hex');
	return `${issued}.${mac}`;
}

export function verify(token: string | undefined): boolean {
	if (!token) return false;
	const [issued, mac] = token.split('.');
	if (!issued || !mac) return false;

	const expected = createHmac('sha256', secret()).update(issued).digest('hex');
	const a = Buffer.from(mac, 'hex');
	const b = Buffer.from(expected, 'hex');
	if (a.length !== b.length) return false;
	if (!timingSafeEqual(a, b)) return false;

	const at = Number(issued);
	if (!Number.isFinite(at)) return false;
	const age = Date.now() - at;
	// A token stamped in the future is a clock change or a forgery attempt.
	return age >= 0 && age < SESSION_MAX_AGE_MS;
}

/** Verify a submitted passcode against the configured bcrypt hash. */
export async function passcodeMatches(input: string): Promise<boolean> {
	const hash = PASSCODE_HASH();
	if (!hash) return false;
	try {
		return await bcrypt.compare(input, hash);
	} catch {
		return false;
	}
}

/* ---------------------------------------------------------------- throttling */

const FREE_ATTEMPTS = 5;
const PENALTIES_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 2 * 60 * 60_000];
const DECAY_MS = 6 * 60 * 60 * 1000;
const FAILURE_DELAY_MS = 750;

type Attempt = { failures: number; lockedUntil: number; last: number };

const attempts = new Map<string, Attempt>();
const MAX_TRACKED = 5_000;

function prune(now: number): void {
	for (const [key, a] of attempts) {
		if (a.lockedUntil < now && now - a.last > DECAY_MS) attempts.delete(key);
	}
	if (attempts.size > MAX_TRACKED) {
		const cold = [...attempts.entries()].sort((x, y) => x[1].last - y[1].last);
		for (const [key] of cold.slice(0, attempts.size - MAX_TRACKED)) attempts.delete(key);
	}
}

/** Milliseconds remaining on a lockout, or 0 if the caller may try. */
export function lockedFor(key: string): number {
	const a = attempts.get(key);
	if (!a) return 0;
	const now = Date.now();
	if (a.lockedUntil > now) return a.lockedUntil - now;
	if (now - a.last > DECAY_MS) attempts.delete(key);
	return 0;
}

/** Record a wrong passcode. Returns the lockout it earned, in ms (0 if none). */
export function noteFailure(key: string): number {
	const now = Date.now();
	prune(now);

	const a = attempts.get(key) ?? { failures: 0, lockedUntil: 0, last: now };
	if (now - a.last > DECAY_MS) a.failures = 0;
	a.failures++;
	a.last = now;

	let penalty = 0;
	if (a.failures > FREE_ATTEMPTS) {
		const step = Math.min(a.failures - FREE_ATTEMPTS - 1, PENALTIES_MS.length - 1);
		penalty = PENALTIES_MS[step] ?? 0;
		a.lockedUntil = now + penalty;
	}

	attempts.set(key, a);
	return penalty;
}

export function noteSuccess(key: string): void {
	attempts.delete(key);
}

/** Flat cost on every wrong answer, paid before the response goes back. */
export const failureDelay = () => new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));

export function describeWait(ms: number): string {
	const mins = Math.ceil(ms / 60_000);
	if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
	const hours = Math.ceil(mins / 60);
	return `${hours} hour${hours === 1 ? '' : 's'}`;
}
