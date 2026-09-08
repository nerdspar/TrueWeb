/**
 * Storage reads (§5.5). Pool health, not pool administration.
 *
 * Signatures confirmed against https://api.truenas.com/v25.10/. The §5.5
 * "never expose" list (pool.create/expand/remove/replace/offline/export,
 * disk.wipe) is enforced in the allowlist's DENYLIST, not here.
 */
import type { TrueNasClient } from './truenas/client.ts';

/**
 * Per-member I/O error counters — the reason this tab exists (§5.5: "Per-member
 * error counts should be prominent and should not require drilling in").
 *
 * The v25.10 reference documents pool.query's `topology` as bare objects with
 * no named sub-schema, so these names come from the live payload of that
 * verified method rather than from the docs. Note that the sibling `zpool.query`
 * *event* documents a similar-but-different schema (`state`, `spares`) — do not
 * assume the two match: this one uses `status` and `spare`.
 */
export type VdevStats = {
	read_errors?: number;
	write_errors?: number;
	checksum_errors?: number;
};

export type Vdev = {
	/** RAIDZ2 / MIRROR / DISK / … */
	type: string;
	/** ONLINE / DEGRADED / FAULTED / … — `status` here, not `state`. */
	status: string;
	/** A partition GUID for members; the vdev label for containers. */
	name: string;
	/** The friendly device name (e.g. "sdh"); null on container vdevs. */
	disk?: string | null;
	guid?: string;
	path?: string | null;
	unavail_disk?: unknown;
	stats?: VdevStats;
	children?: Vdev[];
};

/** The six documented topology groups. `spare` is singular on this schema. */
export type PoolTopology = {
	data: Vdev[];
	log: Vdev[];
	cache: Vdev[];
	spare: Vdev[];
	special: Vdev[];
	dedup: Vdev[];
};

/** A running or finished scrub/resilver, as carried on a pool and by pool.scan. */
export type PoolScan = {
	function?: string;
	state?: string;
	percentage?: number;
	errors?: number;
	total_secs_left?: number | null;
	end_time?: { $date: number } | string | null;
};

/**
 * pool.query — verified: optional [filters, options]; not a job.
 * `fragmentation` is a *string* percentage in the docs, and size/allocated/free
 * are nullable integers.
 */
export type PoolEntry = {
	id: number;
	name: string;
	/** Free string in the docs; ONLINE / DEGRADED / FAULTED are examples. */
	status: string;
	healthy: boolean;
	warning: boolean;
	status_code: string | null;
	status_detail: string | null;
	size: number | null;
	allocated: number | null;
	free: number | null;
	fragmentation: string | null;
	scan: PoolScan | null;
	topology: PoolTopology | null;
};

export function listPools(client: TrueNasClient): Promise<PoolEntry[]> {
	return client.call<PoolEntry[]>('pool.query', []);
}

/**
 * boot.get_state — verified: zero parameters; not a job. Returns one pool-shaped
 * object, which is why the boot pool doesn't appear in pool.query.
 */
export function bootState(client: TrueNasClient): Promise<PoolEntry> {
	return client.call<PoolEntry>('boot.get_state', []);
}

/**
 * disk.query — verified: [filters, options]; not a job. `extra.pools: true` is
 * a documented option that joins the owning pool name onto each disk, which
 * saves a second call to correlate them.
 */
export type DiskEntry = {
	identifier: string;
	name: string;
	serial: string;
	size: number | null;
	model: string;
	description: string;
	type: string;
	rotationrate: number | null;
	bus: string;
	devname: string;
	/** Owning pool name, present because of extra.pools. */
	pool: string | null;
};

export function listDisks(client: TrueNasClient): Promise<DiskEntry[]> {
	return client.call<DiskEntry[]>('disk.query', [[], { extra: { pools: true } }]);
}

/**
 * pool.scrub.scrub — verified: [name, action] where action is START | STOP |
 * PAUSE, and it *is* a job.
 *
 * §5.5 names pool.scrub.run for this, but that method is not a job and only
 * scrubs when the last scrub is older than its `threshold` (35 days by
 * default) — otherwise it returns null having done nothing, which would read
 * as a broken button. This one starts a scrub when asked and reports progress,
 * which is what "manual scrub trigger" means.
 *
 * Both are deprecated in 26.0 in favour of zpool.scrub.run, which is not
 * documented at v25.10 — so this will need revisiting on that upgrade.
 */
export type ScrubAction = 'START' | 'STOP' | 'PAUSE';

export function scrubPool(client: TrueNasClient, name: string, action: ScrubAction) {
	return client.callJob('pool.scrub.scrub', [name, action]);
}
