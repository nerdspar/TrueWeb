import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceStatus } from '$lib/server/service';
import { preflight } from '$lib/server/preflight';
import { validateAppName } from '$lib/compose/inspect';

/**
 * Pre-flight a paste against the live box (§5.2). The YAML has already been
 * parsed and validated client-side; this checks the things only the NAS knows.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const body = (await request.json().catch(() => ({}))) as {
		name?: unknown;
		ports?: unknown;
		paths?: unknown;
	};

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const nameError = validateAppName(name);
	if (nameError) error(400, nameError);

	const ports = Array.isArray(body.ports)
		? body.ports.filter((p): p is number => Number.isInteger(p) && p > 0)
		: [];

	// Only /mnt paths are provisionable, and only they are accepted — this is
	// the boundary where client-supplied paths become filesystem calls.
	const paths = Array.isArray(body.paths)
		? body.paths.filter(
				(p): p is string => typeof p === 'string' && p.startsWith('/mnt/') && !p.includes('..')
			)
		: [];

	return json(await preflight({ name, ports, paths }));
};
