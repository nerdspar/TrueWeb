/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Service worker (§9): cache the shell, never cache API responses.
 *
 * The app is server-rendered, so there is no static HTML shell to serve a
 * navigation from — instead a dedicated offline page is precached and served
 * when a navigation can't reach the network, which is what keeps an offline
 * launch from being a blank white page.
 *
 * Registered by hand from +layout.svelte in production only.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `trueweb-${version}`;
const OFFLINE_PAGE = '/offline.html';

/** Immutable build output plus everything in static/ (icons, manifest, offline). */
const PRECACHE = [...build, ...files];
const PRECACHE_SET = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;

	// Never cache the API or the SSE streams — always live, and a stale app list
	// would be worse than no app list.
	if (url.pathname.startsWith('/api/')) return;

	// Hashed build assets and static files: cache-first, they don't change.
	if (PRECACHE_SET.has(url.pathname)) {
		event.respondWith(cacheFirst(req));
		return;
	}

	// Page navigations: live server render, falling back to the offline page.
	if (req.mode === 'navigate') {
		event.respondWith(navigateOrOffline(req));
	}
});

async function cacheFirst(req: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (res.ok) cache.put(req, res.clone());
	return res;
}

async function navigateOrOffline(req: Request): Promise<Response> {
	try {
		return await fetch(req);
	} catch {
		const cache = await caches.open(CACHE);
		const offline = await cache.match(OFFLINE_PAGE);
		return (
			offline ??
			new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
		);
	}
}
