import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Fetch a compose file from a URL (§12.3, decided: allowed but host-restricted).
 *
 * This is the one place the NAS makes an outbound request on someone else's
 * say-so, so it is deliberately narrow:
 *   - HTTPS only;
 *   - only the GitHub raw hosts, checked on every redirect hop rather than
 *     just the first URL, so a redirect can't walk it onto another host;
 *   - a response size cap, streamed, so a huge file can't exhaust memory;
 *   - a request timeout.
 * It returns text only; nothing is executed and nothing is written to disk.
 */

const ALLOWED_HOSTS = new Set([
	'raw.githubusercontent.com',
	'gist.githubusercontent.com',
	// GitHub redirects raw content to this CDN host.
	'objects.githubusercontent.com'
]);

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_HOPS = 3;

function assertAllowedUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		error(400, 'That is not a valid URL.');
	}
	if (url.protocol !== 'https:') error(400, 'Only https:// URLs are allowed.');
	if (!ALLOWED_HOSTS.has(url.hostname)) {
		error(
			400,
			`Only raw GitHub URLs are allowed (${[...ALLOWED_HOSTS].slice(0, 2).join(', ')}). Paste the file contents instead.`
		);
	}
	return url;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { url?: unknown };
	if (typeof body.url !== 'string' || !body.url.trim()) error(400, 'Give a URL to fetch.');

	let target = assertAllowedUrl(body.url.trim());
	const signal = AbortSignal.timeout(TIMEOUT_MS);

	let res: Response | undefined;
	for (let hop = 0; hop < MAX_HOPS; hop++) {
		res = await fetch(target, {
			signal,
			redirect: 'manual',
			headers: { accept: 'text/plain, */*' }
		}).catch(() => {
			error(502, 'Could not reach that URL.');
		});

		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location');
			if (!location) error(502, 'The server redirected without a destination.');
			// Re-check the host on every hop — this is the point of the exercise.
			target = assertAllowedUrl(new URL(location, target).toString());
			continue;
		}
		break;
	}

	if (!res) error(502, 'Could not reach that URL.');
	if (res.status >= 400) error(502, `That URL returned ${res.status}.`);

	const declared = Number(res.headers.get('content-length') ?? '0');
	if (declared > MAX_BYTES) error(413, 'That file is too large to be a compose file.');

	// Read with a hard cap rather than trusting content-length.
	const reader = res.body?.getReader();
	if (!reader) error(502, 'That URL returned no content.');
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			total += value.byteLength;
			if (total > MAX_BYTES) {
				await reader.cancel();
				error(413, 'That file is too large to be a compose file.');
			}
			chunks.push(value);
		}
	}

	const text = new TextDecoder().decode(
		chunks.reduce((acc, c) => {
			const merged = new Uint8Array(acc.length + c.length);
			merged.set(acc);
			merged.set(c, acc.length);
			return merged;
		}, new Uint8Array())
	);

	return json({ text, source: target.toString() });
};
