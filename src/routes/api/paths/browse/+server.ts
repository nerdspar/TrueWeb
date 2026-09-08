import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { listDir, statPath } from '$lib/server/truenas/methods';

/**
 * Browse the storage tree for the path picker (§5.6). /mnt lists the pools;
 * below that, each entry is either a dataset (is_mountpoint) or a plain
 * directory. Also reports whether a *new* dataset may be created here, so the
 * picker can offer the right actions without duplicating the rule.
 */
export const GET: RequestHandler = async ({ url }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const path = (url.searchParams.get('path') ?? '/mnt').replace(/\/+$/, '') || '/mnt';
	if (path !== '/mnt' && !path.startsWith('/mnt/')) error(400, 'Only /mnt can be browsed.');
	if (path.includes('..')) error(400, 'Invalid path.');

	const client = getClient();
	let entries;
	try {
		entries = await listDir(client, path);
	} catch (err) {
		error(502, (err as Error).message ?? 'Could not list that directory.');
	}

	// Hidden entries (.ix-apps and friends) are TrueNAS's own business.
	const visible = entries
		.filter((e) => !e.name.startsWith('.'))
		.map((e) => ({
			name: e.name,
			path: e.path,
			isDataset: e.is_mountpoint,
			uid: e.uid,
			gid: e.gid
		}));

	// A child dataset can be created wherever we're standing in a dataset — ZFS
	// only requires the parent to be one. /mnt itself is not in a pool.
	const here = path === '/mnt' ? null : await statPath(client, path);
	const canCreateDataset = Boolean(here?.is_mountpoint);

	return json({
		path,
		parent: path === '/mnt' ? null : path.slice(0, path.lastIndexOf('/')) || '/mnt',
		entries: visible,
		canCreateDataset,
		isDataset: canCreateDataset
	});
};
