import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateAppName } from '$lib/compose/inspect';
import { history } from '$lib/server/history';

/**
 * Saved compose versions for one app (§5.3).
 *
 * Without `id`, the list — metadata only, so a phone isn't sent ten composes to
 * render a list of timestamps. With `id`, that version's YAML, fetched when a
 * restore is actually asked for.
 *
 * No TrueNAS call is involved: this is TrueWeb's own record of what it replaced,
 * so it stays readable even when the middleware is down — which is exactly when
 * you might be trying to undo something.
 */
export const GET: RequestHandler = ({ params, url }) => {
	const name = params.name ?? '';
	if (validateAppName(name)) error(400, 'Invalid app name.');

	const idParam = url.searchParams.get('id');
	if (idParam !== null) {
		if (!/^\d+$/.test(idParam)) error(400, 'Invalid version id.');
		const version = history.get(name, Number(idParam));
		if (!version) error(404, 'That version is no longer kept.');
		return json(version);
	}

	return json({
		versions: history.list(name),
		/** Surfaced so the UI can be honest about a restart clearing the list. */
		persistent: history.persistent,
		diskError: history.diskError
	});
};
