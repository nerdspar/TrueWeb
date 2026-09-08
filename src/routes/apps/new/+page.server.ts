import type { PageServerLoad } from './$types';
import { serviceStatus } from '$lib/server/service';

/**
 * The compose paste screen is entirely client-driven (§5.2: parse and validate
 * locally, never round-trip a parse error). All the loader contributes is
 * whether the box is reachable at all.
 */
export const load: PageServerLoad = async () => {
	const status = serviceStatus();
	return {
		reachable: status.ready,
		configured: status.configured,
		reason:
			status.error ??
			(status.configured ? 'Connecting to TrueNAS…' : 'TrueNAS connection is not configured.')
	};
};
