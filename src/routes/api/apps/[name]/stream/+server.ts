import type { RequestHandler } from './$types';
import { getClient, serviceStatus } from '$lib/server/service';
import { statsEvent, logFollowEvent, type AppStats } from '$lib/server/truenas/methods';
import type { CollectionUpdate } from '$lib/server/truenas';

/**
 * Per-app SSE stream for the detail view (§5.1). One connection carries
 * everything that page needs live:
 *   app    { msg, fields }   this app's state changes (app.query)
 *   job    { id, method, state, progress }   action progress (core.get_jobs)
 *   stats  { cpu_usage, memory, networks, blkio }   app.stats, filtered to us
 *   log    { data, timestamp }   app.container_log_follow for ?container=<id>
 *
 * All of these fan out from subscriptions the backend holds once, shared across
 * viewers — the log follow is per (app, container) since the event is
 * parameterized.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const name = params.name;
	const containerId = url.searchParams.get('container') ?? '';
	const encoder = new TextEncoder();

	let closed = false;
	const unsubs: (() => void)[] = [];
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					teardown();
				}
			};

			send('hello', { ready: serviceStatus().ready, container: containerId || null });

			if (serviceStatus().configured) {
				const client = getClient();

				unsubs.push(
					client.subscribe('app.query', (u: CollectionUpdate) => {
						const f = (u.fields ?? {}) as { id?: string; name?: string };
						if (f.id === name || f.name === name || u.id === name) {
							send('app', { msg: u.msg, fields: u.fields });
						}
					})
				);

				unsubs.push(
					client.subscribe('core.get_jobs', (u: CollectionUpdate) => {
						const j = (u.fields ?? {}) as {
							id?: number;
							method?: string;
							state?: string;
							progress?: { percent?: number; description?: string | null };
						};
						send('job', { id: j.id ?? u.id, method: j.method, state: j.state, progress: j.progress });
					})
				);

				// app.stats pushes `fields` as an array covering every app.
				unsubs.push(
					client.subscribe(statsEvent(), (u: CollectionUpdate) => {
						const raw = u.fields as unknown;
						const list = Array.isArray(raw) ? (raw as AppStats[]) : [];
						const mine = list.find((s) => s?.app_name === name);
						if (mine) send('stats', mine);
					})
				);

				if (containerId) {
					unsubs.push(
						client.subscribe(logFollowEvent(name, containerId), (u: CollectionUpdate) => {
							const f = (u.fields ?? {}) as { data?: string; timestamp?: string | null };
							if (typeof f.data === 'string') {
								send('log', { data: f.data, timestamp: f.timestamp ?? null });
							}
						})
					);
				}
			}

			heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					teardown();
				}
			}, 25_000);
			heartbeat.unref?.();

			function teardown() {
				if (closed) return;
				closed = true;
				for (const u of unsubs) u();
				if (heartbeat) clearInterval(heartbeat);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			}
		},
		cancel() {
			closed = true;
			for (const u of unsubs) u();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
