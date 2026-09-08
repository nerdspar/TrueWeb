/**
 * Compose pre-flight against the live box (§5.2).
 *
 * The YAML itself is parsed and validated on the client; this is only the part
 * that needs the NAS: is the name free, do the published ports clash, and for
 * each host path — does it exist, and if not, what should we create?
 */
import { getClient } from './service.ts';
import { DATASET_PARENTS } from './config.ts';
import { listApps, statPath, usedPorts, type StatData } from './truenas/methods.ts';
import {
	ancestorsOf,
	missingSegments,
	recommendKind,
	mntToDataset,
	type ProvisionKind
} from '$lib/compose/paths';

export interface PathReport {
	path: string;
	exists: boolean;
	/** Present when the path already exists. */
	type?: StatData['type'];
	isMountpoint?: boolean;
	uid?: number;
	gid?: number;
	owner?: string | null;
	/** Deepest ancestor that exists — where creation would start. */
	existingAncestor: string | null;
	/** Segments that need creating, outermost first. */
	missing: string[];
	/** What we'd create by default (§5.2). */
	recommended: ProvisionKind;
	/** The ZFS name a dataset would take, when a dataset is possible at all. */
	datasetName: string | null;
	/** Why a dataset isn't on offer, when it isn't. */
	note?: string;
}

export interface PreflightResult {
	nameTaken: boolean;
	portConflicts: number[];
	paths: PathReport[];
}

export async function preflight(opts: {
	name: string;
	ports: number[];
	paths: string[];
}): Promise<PreflightResult> {
	const client = getClient();
	const parents = DATASET_PARENTS();

	const [apps, inUse] = await Promise.all([
		listApps(client).catch(() => []),
		usedPorts(client).catch(() => [] as number[])
	]);

	const taken = new Set<string>();
	for (const a of apps) {
		taken.add(a.name.toLowerCase());
		taken.add(String(a.id).toLowerCase());
	}
	const nameTaken = taken.has(opts.name.toLowerCase());

	const used = new Set(inUse);
	const portConflicts = [...new Set(opts.ports)].filter((p) => used.has(p)).sort((a, b) => a - b);

	// One stat per distinct path across the whole run — a compose file commonly
	// mounts several directories under the same parent.
	const seen = new Map<string, StatData | null>();
	const stat = async (p: string) => {
		if (!seen.has(p)) seen.set(p, await statPath(client, p));
		return seen.get(p) ?? null;
	};

	const paths: PathReport[] = [];
	for (const path of opts.paths) {
		const self = await stat(path);
		if (self) {
			paths.push({
				path,
				exists: true,
				type: self.type,
				isMountpoint: self.is_mountpoint,
				uid: self.uid,
				gid: self.gid,
				owner: self.user,
				existingAncestor: path,
				missing: [],
				recommended: 'directory',
				datasetName: null
			});
			continue;
		}

		// Walk up to the deepest ancestor that does exist.
		let existingAncestor: string | null = null;
		let ancestorStat: StatData | null = null;
		for (const ancestor of ancestorsOf(path)) {
			const s = await stat(ancestor);
			if (s) {
				existingAncestor = ancestor;
				ancestorStat = s;
				break;
			}
		}

		const missing = existingAncestor ? missingSegments(path, existingAncestor) : [];
		const recommended = recommendKind({
			existingAncestor,
			missingCount: missing.length,
			ancestorIsMountpoint: Boolean(ancestorStat?.is_mountpoint),
			datasetParents: parents
		});

		let note: string | undefined;
		if (!existingAncestor) {
			note = 'No parent of this path exists — check the pool name.';
		} else if (recommended === 'directory' && missing.length > 1) {
			note = `Creates ${missing.length} nested directories under ${existingAncestor}.`;
		} else if (recommended === 'directory' && !ancestorStat?.is_mountpoint) {
			note = 'Parent is a directory, not a dataset, so this will be a directory.';
		} else if (recommended === 'directory') {
			note = 'Datasets are only created directly under a configured parent dataset.';
		}

		paths.push({
			path,
			exists: false,
			existingAncestor,
			missing,
			recommended,
			datasetName: recommended === 'dataset' ? mntToDataset(path) : null,
			note
		});
	}

	return { nameTaken, portConflicts, paths };
}
