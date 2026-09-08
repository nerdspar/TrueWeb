import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { dismissAlert } from '$lib/server/dashboard';
import { middlewareFailed } from '$lib/server/mwerror';

/** A UUID, which is what both `uuid` and `id` hold on a real alert. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dismiss one alert (§5.4, tier 1 — reversible in the TrueNAS UI, so no
 * confirmation).
 *
 * alert.dismiss documents its parameter as `uuid` while its summary line says
 * "Dismiss `id` alert", and the reference doesn't say which of the Alert
 * object's two id fields it wants. On this box every alert has uuid === id, so
 * the distinction is moot in practice; the documented parameter name wins.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const body = (await request.json().catch(() => ({}))) as { uuid?: unknown };
	const uuid = typeof body.uuid === 'string' ? body.uuid : '';
	if (!UUID.test(uuid)) error(400, 'Invalid alert id.');

	const client = getClient();
	try {
		await dismissAlert(client, uuid);
		return json({ ok: true });
	} catch (err) {
		middlewareFailed(err, 'Could not dismiss the alert');
	}
};
