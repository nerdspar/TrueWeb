/**
 * Reading ZFS properties off pool.dataset.query (§5.6).
 *
 * The thing to know: a dataset property is not a value, it's an object.
 *
 *   used: { parsed: 15490471254720, rawvalue: "15490471254720",
 *           value: "14.09 TiB", source: "NONE", source_info: null }
 *
 * `parsed` is typed per property — a number for byte counts and recordsize, a
 * *string* for compressratio ("1.03") and compression ("lz4"), and null when
 * the property is unset (an absent quota comes back parsed: null, rawvalue
 * "0"). `value` is TrueNAS's own display string, and it is better than
 * reformatting the number ourselves: it says "14.09 TiB" where a naive
 * formatter says "14 TB", and it matches what the TrueNAS UI shows for the same
 * dataset.
 *
 * So: `value` for display, `parsed` for arithmetic, and neither assumed present.
 */

export type ZfsProp = {
	parsed?: number | string | null;
	rawvalue?: string | null;
	value?: string | null;
	source?: string | null;
};

/** The numeric value, or null when unset or non-numeric. */
export function propNumber(prop: ZfsProp | null | undefined): number | null {
	if (!prop) return null;
	if (typeof prop.parsed === 'number' && Number.isFinite(prop.parsed)) return prop.parsed;
	// compressratio parses as a numeric *string*; rawvalue is the fallback.
	const candidate = typeof prop.parsed === 'string' ? prop.parsed : prop.rawvalue;
	if (typeof candidate !== 'string' || candidate.trim() === '') return null;
	const n = Number(candidate);
	return Number.isFinite(n) ? n : null;
}

/**
 * The display string, preferring TrueNAS's own formatting and falling back to
 * whatever is there. Returns '' rather than 'null' or 'undefined'.
 */
export function propText(prop: ZfsProp | null | undefined): string {
	if (!prop) return '';
	if (typeof prop.value === 'string' && prop.value.trim() !== '') return prop.value;
	if (typeof prop.parsed === 'number') return String(prop.parsed);
	if (typeof prop.parsed === 'string' && prop.parsed.trim() !== '') return prop.parsed;
	if (typeof prop.rawvalue === 'string' && prop.rawvalue.trim() !== '') return prop.rawvalue;
	return '';
}

/**
 * Whether a quota-shaped property is actually set.
 *
 * "No quota" arrives as parsed: null with rawvalue "0", so a plain truthiness
 * check on parsed and a `=== 0` check both get it wrong in different ways.
 */
export function hasQuota(prop: ZfsProp | null | undefined): boolean {
	const n = propNumber(prop);
	return n !== null && n > 0;
}

/** A dataset row as the tree needs it — the `select` list keeps this small. */
export type DatasetRow = {
	id: string;
	name: string;
	type: string;
	mountpoint?: string | null;
	encrypted?: boolean;
	locked?: boolean;
	key_loaded?: boolean;
	used?: ZfsProp;
	available?: ZfsProp;
};

export type TreeNode = {
	row: DatasetRow;
	/** 0 for a pool root. */
	depth: number;
	/** The last path segment — what to show in a list. */
	label: string;
	children: TreeNode[];
};

/**
 * Build the tree from the flat list.
 *
 * pool.dataset.query returns every dataset in one flat array *and* nests each
 * one's children inside it, so the payload is redundant and, with all
 * properties, 671 KB for 61 datasets on this box. Selecting only the fields the
 * list needs brings that to 21 KB — measured — which is why this takes one
 * request and derives the hierarchy from the names rather than lazy-loading a
 * level at a time as §5.6 suggests. Same goal, fewer round trips, and the
 * spec's concern was the payload.
 */
export function buildTree(rows: DatasetRow[]): TreeNode[] {
	const byName = new Map<string, TreeNode>();
	// Shallowest first, so a parent always exists before its children.
	const sorted = [...rows].sort((a, b) => {
		const depth = a.name.split('/').length - b.name.split('/').length;
		return depth !== 0 ? depth : a.name.localeCompare(b.name);
	});

	const roots: TreeNode[] = [];
	for (const row of sorted) {
		const segments = row.name.split('/');
		const node: TreeNode = {
			row,
			depth: segments.length - 1,
			label: segments[segments.length - 1] ?? row.name,
			children: []
		};
		byName.set(row.name, node);
		const parentName = segments.slice(0, -1).join('/');
		const parent = parentName ? byName.get(parentName) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

/**
 * Flatten a tree for rendering, including only the children of expanded nodes.
 * Collapsed by default below the pool roots: 54 of this box's 61 datasets sit
 * at one level, and showing them all at once is a wall.
 */
export function visibleNodes(roots: TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
	const out: TreeNode[] = [];
	const walk = (nodes: TreeNode[]) => {
		for (const node of [...nodes].sort((a, b) => a.label.localeCompare(b.label))) {
			out.push(node);
			if (expanded.has(node.row.name)) walk(node.children);
		}
	};
	walk(roots);
	return out;
}
