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
 * Where small pieces of state may be kept between restarts. Unset ⇒ nothing is
 * written to disk, which is the default because compose files hold secrets
 * verbatim (see composehistory.ts).
 */
export const STATE_DIR = () => env.TRUEWEB_STATE_DIR ?? '';
