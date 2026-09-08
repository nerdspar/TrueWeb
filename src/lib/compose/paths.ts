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
 * Whether a dataset can be created at a path, given what exists above it.
 *
 * Datasets and directories are both allowed anywhere in the hierarchy, so this
 * encodes only what ZFS actually requires: a dataset's parent must itself be a
 * dataset, and it has to exist already. That means exactly one missing segment,
 * directly under a mountpoint — with two levels missing, the immediate parent
 * isn't there yet, so the deeper one can't be created in a single call (create
 * the intermediate one first, then the child).
 */
export function canCreateDatasetAt(opts: {
	existingAncestor: string | null;
	missingCount: number;
	ancestorIsMountpoint: boolean;
}): boolean {
	return Boolean(opts.existingAncestor) && opts.missingCount === 1 && opts.ancestorIsMountpoint;
}

/**
 * What to create by default. A dataset when one is possible — a per-app dataset
 * is the more useful default on TrueNAS (own snapshots, own quota) — and a
 * directory otherwise. Both remain offered wherever both are legal; this is
 * only the pre-selected choice.
 */
export function recommendKind(opts: {
	existingAncestor: string | null;
	missingCount: number;
	ancestorIsMountpoint: boolean;
}): ProvisionKind {
	return canCreateDatasetAt(opts) ? 'dataset' : 'directory';
}
