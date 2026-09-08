import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLifecycleLog } from '$lib/server/lifecyclelog';

/**
 * The tail of the host's app lifecycle log — what TrueNAS points at when an app
 * fails to come up. Read from disk rather than through the middleware, because
 * the only API route to it needs the HTTP download endpoint (§3.1); see
 * $lib/server/lifecyclelog for the bind-mount this depends on.
 *
 * Always answers 200: "not mounted" is a normal state the UI explains, not an
 * error to swallow.
 */
export const GET: RequestHandler = async ({ url }) => {
	const app = url.searchParams.get('app') ?? undefined;
	const lines = Number(url.searchParams.get('lines') ?? '200');
	return json(await readLifecycleLog({ app, lines: Number.isFinite(lines) ? lines : 200 }));
};
