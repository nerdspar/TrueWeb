import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, gateEnabled, verify } from '$lib/server/session';
import { startClient } from '$lib/server/service';

// Open the one long-lived middleware socket as the server comes up (§4), rather
// than on whoever opens the first tab. Idempotent and guarded against build.
startClient();

/* The container HEALTHCHECK can't hold a session, so gating /api/health would
   make the container permanently unhealthy — which reads as "stuck deploying"
   in TrueNAS. Login must be reachable ungated too. */
const UNGATED = new Set(['/login', '/api/health']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.authed = !gateEnabled() || verify(event.cookies.get(COOKIE));

	if (!event.locals.authed && !UNGATED.has(event.url.pathname)) {
		// API routes get a status; pages get sent to the passcode screen.
		if (event.url.pathname.startsWith('/api/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		redirect(303, '/login');
	}

	return resolve(event);
};
