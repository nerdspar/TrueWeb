import type { PageServerLoad } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { getApp } from '$lib/server/truenas/methods';
import { appConfig, configToYaml } from '$lib/server/appconfig';

/**
 * Load a custom app's compose for editing (§5.3). Catalog apps deliberately get
 * a read-only view instead of a generated values form — that form is a large
 * separate subsystem the spec rules out (§5.2 Path B, §5.3).
 */
export const load: PageServerLoad = async ({ params }) => {
	const name = params.name;
	const status = serviceStatus();

	const base = {
		name,
		reachable: false,
		configured: status.configured,
		reason:
			status.error ??
			(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.'),
		isCustom: false,
		yaml: '',
		config: null as Record<string, unknown> | null
	};

	if (!status.ready) return base;

	const client = getClient();
	try {
		const app = await getApp(client, name);
		if (!app) return { ...base, reachable: true, configured: true, reason: 'not-found' };

		const config = await appConfig(client, name);
		return {
			name,
			reachable: true,
			configured: true,
			reason: '',
			isCustom: Boolean(app.custom_app),
			yaml: app.custom_app ? configToYaml(config) : '',
			config: app.custom_app ? null : config
		};
	} catch (err) {
		return { ...base, configured: true, reason: (err as Error).message ?? 'Could not read config.' };
	}
};
