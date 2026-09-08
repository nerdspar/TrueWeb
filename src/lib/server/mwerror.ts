import { error, isHttpError } from '@sveltejs/kit';

/**
 * Turn a middleware failure into a response that says what went wrong.
 *
 * Without this an unhandled rejection becomes a bare 500 "Internal Error",
 * which on a phone is indistinguishable from the app being broken. The
 * middleware's own message is far more use — it names the pool, the permission,
 * or the conflict.
 */
export function middlewareFailed(err: unknown, what: string): never {
	// A deliberate error() from further up is already a good answer.
	if (isHttpError(err)) throw err;
	const message = (err as Error)?.message?.trim() || String(err);
	error(502, `${what}: ${message}`);
}
