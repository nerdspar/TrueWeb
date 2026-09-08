import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	resolveComposeUrl,
	describeComposeNames,
	extractComposeFromMarkdown,
	RAW_HOSTS
} from '$lib/compose/github';

/**
 * Fetch a compose file from a URL (§12.3, decided: allowed but host-restricted).
 *
 * A GitHub repo/tree/blob URL is translated to raw URLs first (see
 * $lib/compose/github) — github.com itself is never contacted. This is the one
 * place the NAS makes an outbound request on someone else's say-so, so it stays
 * narrow:
 *   - HTTPS only, and only the GitHub raw hosts;
 *   - the host is re-checked on every redirect hop, not just the first URL, so
 *     a redirect can't walk it onto another host;
 *   - a streamed response size cap and a request timeout;
 *   - a bounded number of candidates tried.
 * It returns text only; nothing is executed and nothing is written to disk.
 */

const ALLOWED_HOSTS = new Set<string>(RAW_HOSTS);
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
	if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
		error(400, `Refusing to fetch from ${url.hostname}.`);
	}
	return url;
}

/** Fetch one candidate, following allowlisted redirects. null when not found. */
async function tryFetch(candidate: string, signal: AbortSignal): Promise<Response | null> {
	let target = assertAllowedUrl(candidate);

	for (let hop = 0; hop < MAX_HOPS; hop++) {
		const res = await fetch(target, {
			signal,
			redirect: 'manual',
			headers: { accept: 'text/plain, */*' }
		}).catch(() => null);

		if (!res) return null;

		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location');
			if (!location) return null;
			// Re-check the host on every hop — this is the point of the exercise.
			target = assertAllowedUrl(new URL(location, target).toString());
			continue;
		}
		if (res.status === 404) return null;
		if (res.status >= 400) return null;
		return res;
	}
	return null;
}

async function readCapped(res: Response): Promise<string> {
	const declared = Number(res.headers.get('content-length') ?? '0');
	if (declared > MAX_BYTES) error(413, 'That file is too large to be a compose file.');

	const reader = res.body?.getReader();
	if (!reader) error(502, 'That URL returned no content.');

	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_BYTES) {
			await reader.cancel();
			error(413, 'That file is too large to be a compose file.');
		}
		chunks.push(value);
	}

	const merged = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder().decode(merged);
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { url?: unknown };
	if (typeof body.url !== 'string' || !body.url.trim()) error(400, 'Give a URL to fetch.');

	const { kind, candidates, readmes } = resolveComposeUrl(body.url);
	if (kind === 'unsupported' || candidates.length === 0) {
		error(
			400,
			'Only GitHub URLs are supported — a repository, a folder, or a file link (or a raw.githubusercontent.com URL). Otherwise paste the file contents.'
		);
	}

	const signal = AbortSignal.timeout(TIMEOUT_MS);

	// 1. An actual compose file, if the project ships one.
	for (const candidate of candidates) {
		const res = await tryFetch(candidate, signal);
		if (!res) continue;
		const text = await readCapped(res);
		if (!text.trim()) continue;
		return json({ text, source: candidate, from: 'file' });
	}

	// 2. Otherwise mine the README — plenty of projects only document their
	//    stack as a fenced block there.
	for (const readme of readmes) {
		const res = await tryFetch(readme, signal);
		if (!res) continue;
		const markdown = await readCapped(res);
		const block = extractComposeFromMarkdown(markdown);
		if (block?.trim()) {
			return json({ text: block, source: readme, from: 'readme' });
		}
	}

	if (kind === 'repo' || kind === 'directory') {
		error(
			404,
			`No compose file found there (looked for ${describeComposeNames()}, a few common folders, and a compose block in the README). Open the file on GitHub and paste that link, or paste the YAML itself.`
		);
	}
	error(404, 'That file could not be fetched.');
};
