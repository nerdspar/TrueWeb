import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { createCustomApp } from '$lib/server/truenas/methods';
import { validateAppName, inspectCompose } from '$lib/compose/inspect';

/**
 * Deploy a pasted compose file as a custom app (§5.2 / §3.5): app.create with
 * custom_app true and the YAML in custom_compose_config_string. It's a job, so
 * the id comes straight back and progress rides the existing SSE stream.
 *
 * The client validates before ever getting here; this re-checks the two things
 * that must not be taken on trust from a request body — the app name, and that
 * the YAML at least parses and defines services.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!serviceStatus().ready) error(503, 'TrueNAS is not reachable.');

	const body = (await request.json().catch(() => ({}))) as {
		name?: unknown;
		compose?: unknown;
	};

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const nameError = validateAppName(name);
	if (nameError) error(400, nameError);

	const compose = typeof body.compose === 'string' ? body.compose : '';
	const inspection = inspectCompose(compose);
	if (!inspection.ok) error(400, inspection.error?.message ?? 'The compose file is not valid.');

	const client = getClient();
	const { id, done } = await createCustomApp(client, name, compose);
	void done.catch(() => {});
	return json({ ok: true, jobId: id, name });
};
