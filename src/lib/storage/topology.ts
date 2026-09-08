/**
 * Reading a pool's vdev tree (§5.5).
 *
 * The requirement that drives this file: "Per-member error counts should be
 * prominent and should not require drilling in. This box has a history of
 * splitter-induced checksum errors and it is exactly the thing worth seeing at
 * a glance." So the tree is flattened for display and the counts are totalled
 * up to the pool, where a badge can show them without a tap.
 */
import type { PoolTopology, Vdev, VdevStats } from '$lib/server/storage';

/** The six topology groups, in the order they're worth reading. */
export const VDEV_GROUPS = ['data', 'special', 'dedup', 'log', 'cache', 'spare'] as const;
export type VdevGroup = (typeof VDEV_GROUPS)[number];

export type ErrorCounts = { read: number; write: number; checksum: number };

export const NO_ERRORS: ErrorCounts = { read: 0, write: 0, checksum: 0 };

export function errorsOf(stats: VdevStats | undefined): ErrorCounts {
	return {
		read: stats?.read_errors ?? 0,
		write: stats?.write_errors ?? 0,
		checksum: stats?.checksum_errors ?? 0
	};
}

export function addErrors(a: ErrorCounts, b: ErrorCounts): ErrorCounts {
	return { read: a.read + b.read, write: a.write + b.write, checksum: a.checksum + b.checksum };
}

export function anyErrors(e: ErrorCounts): boolean {
	return e.read > 0 || e.write > 0 || e.checksum > 0;
}

export function totalErrors(e: ErrorCounts): number {
	return e.read + e.write + e.checksum;
}

/**
 * A member's own counters plus every descendant's.
 *
 * ZFS reports errors at the level they occurred, so a container vdev can read
 * zero while a disk inside it is failing. Summing the subtree is what makes a
 * pool-level badge honest.
 */
export function subtreeErrors(vdev: Vdev): ErrorCounts {
	let total = errorsOf(vdev.stats);
	for (const child of vdev.children ?? []) {
		total = addErrors(total, subtreeErrors(child));
	}
	return total;
}

export type FlatVdev = {
	/** 0 for a top-level vdev, 1 for its members, and so on. */
	depth: number;
	group: VdevGroup;
	/** RAIDZ2 / MIRROR / DISK / … */
	type: string;
	status: string;
	/** What to call this row: the device name if it has one, else the vdev label. */
	label: string;
	errors: ErrorCounts;
	/** Errors including descendants — what a collapsed row should show. */
	subtree: ErrorCounts;
	healthy: boolean;
	guid: string;
};

/** ZFS member states that mean "this is fine". Anything else is not. */
const HEALTHY_STATES = new Set(['ONLINE', 'AVAIL', 'INUSE']);

export function isHealthyState(status: string | undefined): boolean {
	return HEALTHY_STATES.has((status ?? '').toUpperCase());
}

/**
 * Flatten the tree depth-first into display rows.
 *
 * A member's `name` is a partition GUID on this schema (e.g.
 * "2db50d31-5374-11eb-…") while `disk` is the useful name ("sdh"), so the label
 * prefers `disk` — a list of GUIDs tells you nothing about which drive to pull.
 */
export function flattenTopology(topology: PoolTopology | null | undefined): FlatVdev[] {
	if (!topology) return [];
	const rows: FlatVdev[] = [];

	const walk = (vdev: Vdev, group: VdevGroup, depth: number) => {
		rows.push({
			depth,
			group,
			type: vdev.type ?? '',
			status: vdev.status ?? '',
			label: vdev.disk || vdev.name || vdev.type || 'unknown',
			errors: errorsOf(vdev.stats),
			subtree: subtreeErrors(vdev),
			healthy: isHealthyState(vdev.status),
			guid: vdev.guid ?? `${group}-${depth}-${rows.length}`
		});
		for (const child of vdev.children ?? []) walk(child, group, depth + 1);
	};

	for (const group of VDEV_GROUPS) {
		for (const vdev of topology[group] ?? []) walk(vdev, group, 0);
	}
	return rows;
}

/** Every error counter in the pool, summed. */
export function poolErrors(topology: PoolTopology | null | undefined): ErrorCounts {
	if (!topology) return NO_ERRORS;
	let total = NO_ERRORS;
	for (const group of VDEV_GROUPS) {
		for (const vdev of topology[group] ?? []) total = addErrors(total, subtreeErrors(vdev));
	}
	return total;
}

/** Members that are not in a healthy state — what to surface first. */
export function unhealthyMembers(topology: PoolTopology | null | undefined): FlatVdev[] {
	return flattenTopology(topology).filter((v) => !v.healthy);
}

/** "8 disks" for a pool summary, counting only actual devices. */
export function diskCount(topology: PoolTopology | null | undefined): number {
	return flattenTopology(topology).filter((v) => (v.type ?? '').toUpperCase() === 'DISK').length;
}
