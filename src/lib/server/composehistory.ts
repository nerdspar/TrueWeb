/**
 * The last N saved composes per app, so a bad edit can be undone (§5.3).
 *
 * Storage is in memory by default, and only touches disk when a state directory
 * is configured. That default is deliberate: an app's compose holds its
 * environment verbatim, secrets included, and TrueWeb's *own* compose holds
 * TRUENAS_API_KEY — which §7 says is never written to disk. Persisting history
 * would quietly break that rule for the one app most likely to be edited from
 * inside TrueWeb itself, so it is opt-in and documented rather than the default.
 *
 * Kept free of SvelteKit imports so it can be tested directly.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** One saved compose. `yaml` is the full text, which is what restore needs. */
export type ComposeVersion = {
	/** Monotonic per app. Stable across a restart when persistence is on. */
	id: number;
	/** ISO 8601, UTC. */
	savedAt: string;
	yaml: string;
};

/** What the list endpoint hands the client: everything except the text. */
export type ComposeVersionMeta = Omit<ComposeVersion, 'yaml'> & { bytes: number; lines: number };

const DEFAULT_KEEP = 10;
const FILE = 'compose-history.json';

type Stored = Record<string, ComposeVersion[]>;

export class ComposeHistory {
	#byApp: Stored = {};
	#dir: string;
	#keep: number;
	/** Why persistence is off, when a directory was asked for but can't be used. */
	#diskError = '';

	constructor(opts: { dir?: string; keep?: number } = {}) {
		this.#dir = opts.dir ?? '';
		this.#keep = Math.max(1, opts.keep ?? DEFAULT_KEEP);
		if (this.#dir) this.#load();
	}

	/** True when versions survive a process restart. */
	get persistent(): boolean {
		return Boolean(this.#dir) && !this.#diskError;
	}

	/** Empty unless a state directory was configured and could not be used. */
	get diskError(): string {
		return this.#diskError;
	}

	/**
	 * Record the compose an app had *before* an edit — the state you'd want back.
	 * The live config is always readable from the middleware, so it is not stored
	 * here; history is only the states you have left behind.
	 *
	 * Re-saving an unchanged compose does not add an entry, so a retry after a
	 * failed deploy doesn't push the version you actually want off the end.
	 */
	record(app: string, yaml: string): ComposeVersion | null {
		if (!app || !yaml.trim()) return null;
		const versions = this.#byApp[app] ?? [];
		if (versions.length > 0 && versions[versions.length - 1]?.yaml === yaml) return null;

		const entry: ComposeVersion = {
			id: (versions[versions.length - 1]?.id ?? 0) + 1,
			savedAt: new Date().toISOString(),
			yaml
		};
		// Oldest first in storage; the ring drops from the front.
		this.#byApp[app] = [...versions, entry].slice(-this.#keep);
		this.#save();
		return entry;
	}

	/** Newest first, which is the order they're offered in. */
	list(app: string): ComposeVersionMeta[] {
		return [...(this.#byApp[app] ?? [])].reverse().map(({ id, savedAt, yaml }) => ({
			id,
			savedAt,
			bytes: Buffer.byteLength(yaml, 'utf8'),
			lines: yaml.replace(/\n$/, '').split('\n').length
		}));
	}

	/** One version's text, or null if it has aged out. */
	get(app: string, id: number): ComposeVersion | null {
		return (this.#byApp[app] ?? []).find((v) => v.id === id) ?? null;
	}

	/** Drop an app's history — used when the app itself is deleted. */
	forget(app: string): void {
		if (this.#byApp[app] === undefined) return;
		delete this.#byApp[app];
		this.#save();
	}

	#file(): string {
		return join(this.#dir, FILE);
	}

	#load(): void {
		try {
			mkdirSync(this.#dir, { recursive: true });
			if (!existsSync(this.#file())) return;
			const parsed = JSON.parse(readFileSync(this.#file(), 'utf8')) as Stored;
			// Trust the shape only as far as it can be checked cheaply.
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				for (const [app, versions] of Object.entries(parsed)) {
					if (!Array.isArray(versions)) continue;
					this.#byApp[app] = versions
						.filter(
							(v): v is ComposeVersion =>
								typeof v?.id === 'number' &&
								typeof v?.savedAt === 'string' &&
								typeof v?.yaml === 'string'
						)
						.slice(-this.#keep);
				}
			}
		} catch (err) {
			// A corrupt or unreadable file must not take the app down; history is a
			// convenience, and losing it is not worth a 500 on every save.
			this.#diskError = (err as Error).message ?? 'could not read the history file';
		}
	}

	#save(): void {
		if (!this.#dir || this.#diskError) return;
		try {
			mkdirSync(this.#dir, { recursive: true });
			// Written 0600, and replaced atomically so a crash mid-write can't
			// leave a half-file that fails to parse on the next start.
			const tmp = `${this.#file()}.tmp`;
			writeFileSync(tmp, JSON.stringify(this.#byApp), { encoding: 'utf8', mode: 0o600 });
			renameSync(tmp, this.#file());
		} catch (err) {
			this.#diskError = (err as Error).message ?? 'could not write the history file';
		}
	}
}
