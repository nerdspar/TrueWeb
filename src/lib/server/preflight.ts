/**
 * Compose pre-flight against the live box (§5.2).
 *
 * The YAML itself is parsed and validated on the client; this is only the part
 * that needs the NAS: is the name free, do the published ports clash, and for
 * each host path — does it exist, and if not, what should we create?
 */
import { getClient } from './service.ts';
import { listApps, statPath, usedPorts, type StatData } from './truenas/methods.ts';
import {
	ancestorsOf,
	missingSegments,
	recommendKind,
	canCreateDatasetAt,
	mntToDataset
} from '$lib/compose/paths';
import type { PathReport, PreflightResult, PortSuggestion } from '$lib/compose/types';

export type { PathReport, PreflightResult } from '$lib/compose/types';

export async function preflight(opts: {
	name: string;
	ports: number[];
	paths: string[];
}): Promise<PreflightResult> {
	const client = getClient();

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
	const requested = new Set(opts.ports);
	const portConflicts = [...requested].filter((p) => used.has(p)).sort((a, b) => a - b);

	// Suggest a free port, skipping anything already used by an app or claimed by
	// this same compose file. Searching starts at 8000 rather than just above the
	// clash: app.used_ports only knows about *apps*, so it can't see the TrueNAS
	// UI or other system services, and suggesting 444 after a clash on 443 would
	// walk straight into one.
	const FIRST_SUGGESTED = 8000;
	const claimed = new Set<number>([...used, ...requested]);
	const portSuggestions: PortSuggestion[] = portConflicts.map((port) => {
		let candidate = Math.max(port + 1, FIRST_SUGGESTED);
		while (candidate < 65535 && claimed.has(candidate)) candidate++;
		claimed.add(candidate);
		return { port, suggested: candidate };
	});

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
		const shape = {
			existingAncestor,
			missingCount: missing.length,
			ancestorIsMountpoint: Boolean(ancestorStat?.is_mountpoint)
		};
		const recommended = recommendKind(shape);
		const canBeDataset = canCreateDatasetAt(shape);

		let note: string | undefined;
		if (!existingAncestor) {
			note = 'No parent of this path exists — check the pool name.';
		} else if (missing.length > 1) {
			note = `${missing.length} levels are missing under ${existingAncestor}, so these are created as directories. Make the parent a dataset first if you want one.`;
		} else if (!ancestorStat?.is_mountpoint) {
			note = `${existingAncestor} is a directory, not a dataset, so this will be a directory.`;
		}

		paths.push({
			path,
			exists: false,
			existingAncestor,
			missing,
			recommended,
			// Offered whenever ZFS allows it, not only when it's the default.
			datasetName: canBeDataset ? mntToDataset(path) : null,
			note
		});
	}

	return { nameTaken, portConflicts, portSuggestions, paths };
}
