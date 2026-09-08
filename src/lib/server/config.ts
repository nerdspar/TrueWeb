/**
 * App-level configuration (§7). Distinct from the TrueNAS connection config in
 * $lib/server/truenas/env.ts — this covers the passcode gate and session.
 */
import { env } from '$env/dynamic/private';

/** bcrypt hash of the shared passcode. Empty ⇒ the gate is disabled (LAN default). */
export const PASSCODE_HASH = () => env.TRUEWEB_PASSCODE_HASH ?? '';

/** HMAC secret for signing session cookies. Required only when the gate is on. */
export const SESSION_SECRET = () => env.TRUEWEB_SESSION_SECRET ?? '';

/** Whether the passcode gate is active. */
export const gateEnabled = () => Boolean(PASSCODE_HASH());

/**
 * Absolute paths under which the compose flow may create a dataset for a
 * missing host path (§5.2). Empty falls back to a parent dataset named "Data"
 * under any pool — see $lib/compose/paths.ts.
 */
export const DATASET_PARENTS = (): string[] =>
	(env.TRUEWEB_DATASET_PARENTS ?? '')
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
