/**
 * Host-path helpers for dataset provisioning (§5.2 / §5.6).
 *
 * The classification itself needs filesystem.stat (server-side), but the path
 * arithmetic and the recommendation rule are pure and live here so they can be
 * tested without a NAS.
 */

/** What to create for a missing host path. */
export type ProvisionKind = 'dataset' | 'directory';

export interface PathPlan {
	/** The requested host path, e.g. /mnt/NAS/Data/foo */
	path: string;
	/** Deepest ancestor that already exists, e.g. /mnt/NAS/Data */
	existingAncestor: string | null;
	/** Whether that ancestor is a dataset mountpoint (filesystem.stat). */
	ancestorIsMountpoint: boolean;
	/** Segments that don't exist yet, outermost first. */
	missing: string[];
	/** What we'd create by default. */
	recommended: ProvisionKind;
}

/**
 * /mnt/NAS/Data/foo → NAS/Data/foo. pool.dataset.create takes the ZFS name
 * (pool included, no /mnt prefix) — verified against v25.10.
 */
export function mntToDataset(path: string): string | null {
	const trimmed = path.replace(/\/+$/, '');
	if (!trimmed.startsWith('/mnt/')) return null;
	const rest = trimmed.slice('/mnt/'.length);
	// Needs at least pool + one child to be a creatable dataset.
	return rest.includes('/') ? rest : null;
}

/** The pool name for a /mnt path, or null if it isn't one. */
export function poolOf(path: string): string | null {
	const trimmed = path.replace(/\/+$/, '');
	if (!trimmed.startsWith('/mnt/')) return null;
	return trimmed.slice('/mnt/'.length).split('/')[0] ?? null;
}

/**
 * Ancestors to probe with filesystem.stat, deepest first, stopping at the pool
 * mountpoint (/mnt itself is never a dataset and never ours to create).
 */
export function ancestorsOf(path: string): string[] {
	const trimmed = path.replace(/\/+$/, '');
	if (!trimmed.startsWith('/mnt/')) return [];
	const segments = trimmed.slice('/mnt/'.length).split('/').filter(Boolean);
	const out: string[] = [];
	// Stop before the pool root itself is dropped: keep /mnt/POOL as the last.
	for (let i = segments.length - 1; i >= 1; i--) {
		out.push(`/mnt/${segments.slice(0, i).join('/')}`);
	}
	return out;
}

/** Segments of `path` below `ancestor`, outermost first. */
export function missingSegments(path: string, ancestor: string): string[] {
	const p = path.replace(/\/+$/, '');
	const a = ancestor.replace(/\/+$/, '');
	if (!p.startsWith(`${a}/`)) return [];
	return p.slice(a.length + 1).split('/').filter(Boolean);
}

/**
 * §5.2: "Default to dataset for a direct child of a known config parent,
 * directory otherwise." Read as: exactly one missing segment directly under an
 * existing *dataset* is the case where a dataset is the right thing to create.
 * Anything deeper, or under a plain directory, gets a directory — nesting a
 * dataset several levels down under a non-dataset parent is not what someone
 * pasting a compose file means.
 */
export function recommendKind(opts: {
	missingCount: number;
	ancestorIsMountpoint: boolean;
}): ProvisionKind {
	return opts.missingCount === 1 && opts.ancestorIsMountpoint ? 'dataset' : 'directory';
}
