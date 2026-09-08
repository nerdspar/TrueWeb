/**
 * A minimal line diff, for showing what a compose edit changes before it is
 * committed (§5.3: "on a small screen it is very easy to have edited the wrong
 * line").
 *
 * Longest-common-subsequence over lines — enough to show added and removed
 * lines with context, which is the question being asked. Pure and tested.
 */

export type DiffKind = 'same' | 'add' | 'remove';

export interface DiffLine {
	kind: DiffKind;
	text: string;
	/** 1-based line number in the old text, when present. */
	oldLine?: number;
	/** 1-based line number in the new text, when present. */
	newLine?: number;
}

/** Guard against a pathological diff on a huge paste. */
const MAX_LINES = 4000;

/**
 * Split into lines, ignoring one trailing newline. Empty text is zero lines,
 * not one empty line — `''.split('\n')` gives `['']`, which would otherwise
 * show up as a phantom blank line added or removed.
 */
function toLines(text: string): string[] {
	const trimmed = text.replace(/\n$/, '');
	return trimmed === '' ? [] : trimmed.split('\n');
}

export function diffLines(before: string, after: string): DiffLine[] {
	const a = toLines(before);
	const b = toLines(after);

	if (a.length > MAX_LINES || b.length > MAX_LINES) {
		// Too big to be worth an LCS; report wholesale.
		return [
			...a.map((text, i): DiffLine => ({ kind: 'remove', text, oldLine: i + 1 })),
			...b.map((text, i): DiffLine => ({ kind: 'add', text, newLine: i + 1 }))
		];
	}

	// lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
	const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0)
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
		}
	}

	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: 'same', text: a[i]!, oldLine: i + 1, newLine: j + 1 });
			i++;
			j++;
		} else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
			out.push({ kind: 'remove', text: a[i]!, oldLine: i + 1 });
			i++;
		} else {
			out.push({ kind: 'add', text: b[j]!, newLine: j + 1 });
			j++;
		}
	}
	while (i < a.length) out.push({ kind: 'remove', text: a[i]!, oldLine: ++i });
	while (j < b.length) out.push({ kind: 'add', text: b[j]!, newLine: ++j });

	return out;
}

/** Just the changed lines, with a little context around each run. */
export function summarise(diff: DiffLine[], context = 2): DiffLine[] {
	const keep = new Set<number>();
	diff.forEach((line, idx) => {
		if (line.kind === 'same') return;
		for (let k = idx - context; k <= idx + context; k++) {
			if (k >= 0 && k < diff.length) keep.add(k);
		}
	});
	return diff.filter((_, idx) => keep.has(idx));
}

export function countChanges(diff: DiffLine[]): { added: number; removed: number } {
	return {
		added: diff.filter((d) => d.kind === 'add').length,
		removed: diff.filter((d) => d.kind === 'remove').length
	};
}
