/**
 * Turn a GitHub URL into raw-content URLs to try (§12.3).
 *
 * The defining journey is finding a project while browsing GitHub on a phone —
 * and what you have there is the repository page, not a raw file link. So a
 * repo, tree or blob URL is translated here into candidate raw URLs.
 *
 * This is deliberately only a *translation*: github.com is never fetched. The
 * fetch endpoint still talks exclusively to the allowlisted raw hosts, so the
 * outbound surface is unchanged.
 *
 * Pure and unit tested.
 */

export const RAW_HOSTS = [
	'raw.githubusercontent.com',
	'gist.githubusercontent.com',
	// GitHub redirects raw content here.
	'objects.githubusercontent.com'
] as const;

/** Root-level compose filenames, in the order they're worth trying. */
const COMPOSE_NAMES = [
	'docker-compose.yml',
	'docker-compose.yaml',
	'compose.yml',
	'compose.yaml'
] as const;

/** Directories other than the root that commonly hold a compose file. */
const COMPOSE_DIRS = ['examples', 'example', 'docker', 'deploy'] as const;

/** Default branches to probe when the URL doesn't name one. */
const BRANCHES = ['main', 'master'] as const;

/** README filenames to mine when no compose file exists. */
const READMES = ['README.md', 'readme.md'] as const;

export type ResolveKind = 'raw' | 'file' | 'directory' | 'repo' | 'unsupported';

export interface ResolvedUrls {
	kind: ResolveKind;
	/** Raw compose-file URLs to try in order. Empty when 'unsupported'. */
	candidates: string[];
	/**
	 * READMEs to mine for a fenced compose block if no file is found. Plenty of
	 * projects only document their stack in the README — which is exactly the
	 * journey §5.2 describes.
	 */
	readmes: string[];
}

function stripGit(repo: string): string {
	return repo.replace(/\.git$/, '');
}

function rawUrl(owner: string, repo: string, branch: string, path: string): string {
	return `https://raw.githubusercontent.com/${owner}/${stripGit(repo)}/${branch}/${path}`;
}

function composeCandidates(owner: string, repo: string, branch: string, dir: string): string[] {
	const prefix = dir ? `${dir.replace(/^\/+|\/+$/g, '')}/` : '';
    return COMPOSE_NAMES.map((name) => rawUrl(owner, repo, branch, `${prefix}${name}`));
}

/**
 * Resolve any supported URL to the raw URLs worth trying.
 *  - a raw/gist URL is used as-is;
 *  - .../blob/<branch>/<file> and .../raw/<branch>/<file> map to that file;
 *  - .../tree/<branch>/<dir> looks for a compose file in that directory;
 *  - a bare repo URL looks for one at the root of main, then master.
 */
export function resolveComposeUrl(input: string): ResolvedUrls {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return { kind: 'unsupported', candidates: [], readmes: [] };
	}

	const host = url.hostname.toLowerCase().replace(/^www\./, '');

	// Already a raw URL — take it at face value.
	if ((RAW_HOSTS as readonly string[]).includes(host)) {
		return { kind: 'raw', candidates: [url.toString()], readmes: [] };
	}

	if (host !== 'github.com') return { kind: 'unsupported', candidates: [], readmes: [] };

	const parts = url.pathname.split('/').filter(Boolean);
	const [owner, repo, ...rest] = parts;
	if (!owner || !repo) return { kind: 'unsupported', candidates: [], readmes: [] };

	// .../blob/<branch>/<path...> or .../raw/<branch>/<path...>
	if ((rest[0] === 'blob' || rest[0] === 'raw') && rest[1] && rest.length > 2) {
		const branch = rest[1];
		const path = rest.slice(2).join('/');
		return { kind: 'file', candidates: [rawUrl(owner, repo, branch, path)], readmes: [] };
	}

	// .../tree/<branch>[/<dir...>]
	if (rest[0] === 'tree' && rest[1]) {
		const branch = rest[1];
		const dir = rest.slice(2).join('/');
		const prefix = dir ? `${dir}/` : '';
		return {
			kind: 'directory',
			candidates: composeCandidates(owner, repo, branch, dir),
			readmes: [rawUrl(owner, repo, branch, `${prefix}README.md`)]
		};
	}

	// Bare repository URL: probe the usual filenames, then the usual places, and
	// fall back to mining the README. Bounded on purpose — every entry is a
	// request, and 404s are the common case.
	if (rest.length === 0) {
		const candidates = BRANCHES.flatMap((branch) => composeCandidates(owner, repo, branch, ''));
		for (const dir of COMPOSE_DIRS) {
			candidates.push(rawUrl(owner, repo, 'main', `${dir}/docker-compose.yml`));
			candidates.push(rawUrl(owner, repo, 'main', `${dir}/compose.yaml`));
		}
		const readmes = BRANCHES.flatMap((branch) =>
			READMES.map((file) => rawUrl(owner, repo, branch, file))
		);
		return { kind: 'repo', candidates, readmes };
	}

	return { kind: 'unsupported', candidates: [], readmes: [] };
}

/**
 * Pull a compose stack out of Markdown. Many projects only document their
 * stack as a fenced block in the README, which is precisely the paste that
 * §5.2's sanitiser exists for — so mine it directly rather than making someone
 * copy it by hand on a phone.
 *
 * Picks the first fenced block that actually looks like a compose file (has a
 * top-level `services:`), preferring yaml-tagged blocks.
 */
export function extractComposeFromMarkdown(markdown: string): string | null {
	const blocks: { lang: string; body: string }[] = [];
	const fence = /^[ \t]*```[ \t]*([\w-]*)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
	for (const m of markdown.matchAll(fence)) {
		blocks.push({ lang: (m[1] ?? '').toLowerCase(), body: m[2] ?? '' });
	}

	const looksLikeCompose = (body: string) => /^[ \t]*services[ \t]*:/m.test(body);
	const yamlish = (lang: string) => lang === '' || lang === 'yaml' || lang === 'yml';

	return (
		blocks.find((b) => yamlish(b.lang) && looksLikeCompose(b.body))?.body ??
		blocks.find((b) => looksLikeCompose(b.body))?.body ??
		null
	);
}

/** Human-readable list of what a repo probe looks for, for error messages. */
export function describeComposeNames(): string {
	return COMPOSE_NAMES.join(', ');
}

/**
 * The repository slug, for guessing an app name. Both github.com and the raw
 * hosts put owner/repo first, so one rule covers them.
 */
export function repoNameFromUrl(input: string): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	if (host !== 'github.com' && !(RAW_HOSTS as readonly string[]).includes(host)) return null;

	const repo = url.pathname.split('/').filter(Boolean)[1];
	return repo ? stripGit(repo) : null;
}

/** Best-effort app name from a repo slug: lowercase, hyphens only. */
export function suggestAppName(repo: string): string {
	return repo
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[^a-z]+/, '')
		.replace(/-+$/, '')
		.slice(0, 40)
		.replace(/-+$/, '');
}
