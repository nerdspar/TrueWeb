/**
 * Targeted edits to compose text (§5.2).
 *
 * The picker rewrites a bind mount's host path in place rather than
 * reformatting the file: a paste should come back out looking like what was
 * pasted, minus the fixes the user asked for. That means operating on the text,
 * not re-serialising the parsed document — so it is done narrowly, and tested.
 */

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the host side of a bind mount, in both compose volume syntaxes:
 *   - short:  `- ./data:/app/data`  or  `- "./data:/app/data:ro"`
 *   - long:   `source: ./data`
 *
 * Only the host side is touched; the container path and any mode flag are left
 * exactly as they were. Returns the new text and how many places changed.
 */
export function replaceVolumeSource(
	text: string,
	oldSource: string,
	newSource: string
): { text: string; replaced: number } {
	if (!oldSource || oldSource === newSource) return { text, replaced: 0 };

	const old = escapeRegExp(oldSource);
	let replaced = 0;

	// Short syntax: a list item whose first colon-separated field is the source.
	// The optional quote is preserved by capturing it.
	const short = new RegExp(`(^[ \\t]*-[ \\t]*["']?)${old}(?=:)`, 'gm');
	let out = text.replace(short, (_m, lead: string) => {
		replaced++;
		return `${lead}${newSource}`;
	});

	// Long syntax: an explicit `source:` key.
	const long = new RegExp(`(^[ \\t]*source[ \\t]*:[ \\t]*["']?)${old}(["']?[ \\t]*$)`, 'gm');
	out = out.replace(long, (_m, lead: string, tail: string) => {
		replaced++;
		return `${lead}${newSource}${tail}`;
	});

	return { text: out, replaced };
}

/**
 * Change the *host* side of a published port, in both compose syntaxes:
 *   - short:  `- "8080:80"`, `- 127.0.0.1:8080:80`, `- "8080:80/tcp"`
 *   - long:   `published: 8080`
 *
 * The container port, any bind address and any /proto suffix are left alone. A
 * host port is always the field immediately followed by `:`, which is what
 * keeps a container port of the same number from being rewritten by mistake.
 * Ranges are deliberately not touched — splitting one is not a safe guess.
 */
export function replaceHostPort(
	text: string,
	oldPort: number,
	newPort: number
): { text: string; replaced: number } {
	if (!Number.isInteger(oldPort) || !Number.isInteger(newPort)) return { text, replaced: 0 };
	if (oldPort === newPort || newPort < 1 || newPort > 65535) return { text, replaced: 0 };

	let replaced = 0;

	// Short syntax. The optional group is a bind address (`127.0.0.1:`).
	const short = new RegExp(
		`(^[ \\t]*-[ \\t]*["']?)((?:\\d{1,3}(?:\\.\\d{1,3}){3}:)?)${oldPort}(?=:)`,
		'gm'
	);
	let out = text.replace(short, (_m, lead: string, host: string) => {
		replaced++;
		return `${lead}${host}${newPort}`;
	});

	// Long syntax.
	const long = new RegExp(`(^[ \\t]*published[ \\t]*:[ \\t]*["']?)${oldPort}(["']?[ \\t]*$)`, 'gm');
	out = out.replace(long, (_m, lead: string, tail: string) => {
		replaced++;
		return `${lead}${newPort}${tail}`;
	});

	return { text: out, replaced };
}
