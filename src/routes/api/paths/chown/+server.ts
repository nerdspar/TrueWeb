import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { chownPath } from '$lib/server/truenas/methods';
import { middlewareFailed } from '$lib/server/mwerror';

/**
 * Set ownership on a provisioned path (§5.2). A dataset created with default
 * permissions frequently leaves the container unable to write, which surfaces
 * later as an opaque crash loop — so this exists, but it is always an explicit
 * choice in the UI rather than something applied automatically.
 *
 * filesystem.chown is a job (verified), so this returns a job id.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const body = (await request.json().catch(() => ({}))) as {
		path?: unknown;
		uid?: unknown;
		gid?: unknown;
		recursive?: unknown;
	};

	const path = typeof body.path === 'string' ? body.path.replace(/\/+$/, '') : '';
	if (!path.startsWith('/mnt/') || path.includes('..')) {
		error(400, 'Only paths under /mnt can be changed.');
	}

	const uid = Number(body.uid);
	const gid = Number(body.gid);
	if (!Number.isInteger(uid) || uid < 0) error(400, 'UID must be a non-negative whole number.');
	if (!Number.isInteger(gid) || gid < 0) error(400, 'GID must be a non-negative whole number.');

	const recursive = body.recursive !== false;

	const client = getClient();
	try {
		const { id, done } = await chownPath(client, path, uid, gid, recursive);
		void done.catch(() => {});
		return json({ ok: true, jobId: id });
	} catch (err) {
		middlewareFailed(err, `Could not set ownership on ${path}`);
	}
};
