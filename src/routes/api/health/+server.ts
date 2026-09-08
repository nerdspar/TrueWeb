import { json } from '@sveltejs/kit';
import { serviceStatus } from '$lib/server/service';

/**
 * Liveness for the container HEALTHCHECK. Reports 200 whenever the web server is
 * up, including while the middleware is briefly unreachable — a middleware
 * restart is normal, not a container failure (§5.1). The NAS state rides along
 * as info; only a hard config error (bad/missing env) flips ok to false.
 */
export function GET() {
	const nas = serviceStatus();
	return json({ ok: nas.configured, nas }, { status: nas.configured ? 200 : 503 });
}
