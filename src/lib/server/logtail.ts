/**
 * Reading the tail of a log file on disk.
 *
 * Kept free of any SvelteKit import so the fiddly parts — the partial first
 * line when starting mid-file, narrowing to an app, the size cap — can be unit
 * tested. The env-configured wrapper lives in ./lifecyclelog.ts.
 */
import { open, stat } from 'node:fs/promises';

/** Only the tail is ever read, however big the file has grown. */
export const MAX_TAIL_BYTES = 256 * 1024;

export interface LogTail {
	available: boolean;
	path: string;
	/** Tail lines, oldest first. Empty when unavailable. */
	lines: string[];
	/** Whether `lines` was narrowed to an app name. */
	filtered: boolean;
	/** Why it isn't available, when it isn't. */
	reason?: string;
}

/**
 * Read the last lines of `path`, preferring lines that mention `app`. Falls
 * back to the plain tail when narrowing finds nothing, since a failure can be
 * logged without naming the app.
 */
export async function readTail(
	path: string,
	opts: { app?: string; lines?: number; maxBytes?: number } = {}
): Promise<LogTail> {
	const want = Math.min(Math.max(opts.lines ?? 200, 1), 2000);
	const maxBytes = opts.maxBytes ?? MAX_TAIL_BYTES;
	const base: LogTail = { available: false, path, lines: [], filtered: false };

	let size: number;
	try {
		const info = await stat(path);
		if (!info.isFile()) return { ...base, reason: 'It is not a file.' };
		size = info.size;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return {
			...base,
			reason:
				code === 'ENOENT'
					? `It isn't visible from where TrueWeb is running.`
					: code === 'EACCES'
						? `TrueWeb doesn't have permission to read it.`
						: `It could not be read (${code ?? 'unknown error'}).`
		};
	}

	let text = '';
	try {
		const handle = await open(path, 'r');
		try {
			const length = Math.min(size, maxBytes);
			const position = Math.max(0, size - length);
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await handle.read(buffer, 0, length, position);
			text = buffer.subarray(0, bytesRead).toString('utf8');
		} finally {
			await handle.close();
		}
	} catch (err) {
		return { ...base, reason: `It could not be read: ${(err as Error).message}` };
	}

	// Starting mid-file leaves a partial first line; drop it.
	const all = text.split('\n');
	if (size > maxBytes && all.length > 1) all.shift();
	const tail = all.map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0);

	const app = opts.app?.trim();
	if (app) {
		const narrowed = tail.filter((l) => l.includes(app));
		if (narrowed.length > 0) {
			return { available: true, path, lines: narrowed.slice(-want), filtered: true };
		}
	}

	return { available: true, path, lines: tail.slice(-want), filtered: false };
}
