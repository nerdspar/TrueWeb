import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { createDataset, mkdir } from '$lib/server/truenas/methods';
import { mntToDataset, missingSegments } from '$lib/compose/paths';
import { middlewareFailed } from '$lib/server/mwerror';

/**
 * Create one missing host path (§5.2 / §5.6) — as a dataset or as directories.
 * Neither pool.dataset.create nor filesystem.mkdir is a job (verified), so both
 * answer synchronously.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const body = (await request.json().catch(() => ({}))) as {
		path?: unknown;
		kind?: unknown;
		from?: unknown;
	};

	const path = typeof body.path === 'string' ? body.path.replace(/\/+$/, '') : '';
	const kind = body.kind === 'dataset' ? 'dataset' : 'directory';
	// Where creation starts — the deepest existing ancestor from pre-flight.
	const from = typeof body.from === 'string' ? body.from.replace(/\/+$/, '') : '';

	if (!path.startsWith('/mnt/') || path.includes('..')) {
		error(400, 'Only paths under /mnt can be created.');
	}

	const client = getClient();

	if (kind === 'dataset') {
		const name = mntToDataset(path);
		if (!name) error(400, 'That path is not a valid dataset location.');
		try {
			await createDataset(client, name);
		} catch (err) {
			middlewareFailed(err, `Could not create dataset ${name}`);
		}
		return json({ ok: true, created: 'dataset', path, dataset: name });
	}

	// Directories: create each missing level in turn. filesystem.mkdir isn't
	// documented as recursive, so don't assume it is.
	const segments = from && path.startsWith(`${from}/`) ? missingSegments(path, from) : [];
	const levels = segments.length > 0 ? segments : [];
	if (levels.length === 0) {
		try {
			await mkdir(client, path);
		} catch (err) {
			middlewareFailed(err, `Could not create ${path}`);
		}
		return json({ ok: true, created: 'directory', path, made: [path] });
	}

	const made: string[] = [];
	let current = from;
	for (const segment of levels) {
		current = `${current}/${segment}`;
		try {
			await mkdir(client, current);
		} catch (err) {
			middlewareFailed(err, `Could not create ${current}`);
		}
		made.push(current);
	}
	return json({ ok: true, created: 'directory', path, made });
};
