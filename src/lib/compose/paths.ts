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
 * The dataset parents recognised when none are configured: a parent dataset
 * literally named `Data`, under any pool. This is the "known config parent" of
 * §5.2 — new app datasets belong directly under it and nowhere else.
 */
const DEFAULT_PARENT_BASENAMES = ['Data'];

const trimSlash = (p: string) => p.replace(/\/+$/, '');

/**
 * Whether a missing path's parent is somewhere a *dataset* may be created.
 * `configured` (TRUEWEB_DATASET_PARENTS) takes precedence when set, so the
 * layout of a given box is configuration rather than a code change.
 */
export function isDatasetParent(ancestor: string, configured: string[] = []): boolean {
	if (configured.length > 0) {
		return configured.map(trimSlash).includes(trimSlash(ancestor));
	}
	const base = trimSlash(ancestor).split('/').pop() ?? '';
	return DEFAULT_PARENT_BASENAMES.includes(base);
}

/**
 * §5.2: "Default to dataset for a direct child of a known config parent,
 * directory otherwise." Only a single missing segment directly under a
 * recognised parent dataset becomes a dataset; anything deeper, anywhere else,
 * or under a plain directory becomes a directory. Creating datasets several
 * levels down is not what someone pasting a compose file means, and it makes a
 * mess of the dataset tree.
 */
export function recommendKind(opts: {
	existingAncestor: string | null;
	missingCount: number;
	ancestorIsMountpoint: boolean;
	datasetParents?: string[];
}): ProvisionKind {
	const { existingAncestor, missingCount, ancestorIsMountpoint, datasetParents = [] } = opts;
	if (missingCount !== 1 || !ancestorIsMountpoint || !existingAncestor) return 'directory';
	return isDatasetParent(existingAncestor, datasetParents) ? 'dataset' : 'directory';
}
