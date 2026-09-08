/**
 * The `reporting.realtime` payload (§5.4).
 *
 * The API reference documents the *methods* well but not this event's body, so
 * these names were read off the live feed from a 25.10.4 box and are what the
 * middleware actually sends. Everything is optional: the shape varies with
 * hardware (core count, NIC names, pool names), and a field that exists on one
 * box is not a field that exists on every box.
 */

/** One CPU entry. `cpu` is the aggregate; `cpu0`…`cpuN` are per-thread. */
export type CpuSample = { usage?: number; temp?: number };

export type RealtimeUpdate = {
	cpu?: Record<string, CpuSample>;
	memory?: {
		physical_memory_total?: number;
		physical_memory_available?: number;
		arc_size?: number;
		arc_free_memory?: number;
		arc_available_memory?: number;
	};
	disks?: {
		read_ops?: number;
		read_bytes?: number;
		write_ops?: number;
		write_bytes?: number;
		/** Percentage, and it can exceed 100 across several disks. */
		busy?: number;
	};
	interfaces?: Record<
		string,
		{
			link_state?: string;
			/** Link speed in Mbit/s. */
			speed?: number;
			received_bytes_rate?: number;
			sent_bytes_rate?: number;
		}
	>;
	/** Capacity per pool, in bytes. Includes boot-pool. */
	pools?: Record<string, { available?: number; used?: number; total?: number }>;
};

/**
 * Where a pool's fullness stops being a number and starts being a problem.
 *
 * ZFS allocation slows down markedly once a pool is mostly full — it has less
 * contiguous free space to write into — and the effect is well established
 * around the 80% mark. A dashboard that shows 90% as just another blue bar is
 * failing at the one job it has, so this drives an actual warning.
 */
export const POOL_WARN_PERCENT = 80;
export const POOL_CRITICAL_PERCENT = 90;

/** Fullness as a percentage, or null when the numbers aren't usable. */
export function poolUsedPercent(pool: {
	used?: number;
	total?: number;
	available?: number;
}): number | null {
	if (typeof pool.used !== 'number') return null;
	// The fallback needs `available` to be present, not merely absent-as-zero:
	// with only `used` known the pool's size is unknown, and treating that as
	// "100% full" would fire the capacity warning on missing data.
	const total =
		typeof pool.total === 'number'
			? pool.total
			: typeof pool.available === 'number'
				? pool.used + pool.available
				: null;
	if (total === null || total <= 0) return null;
	return Math.min(100, Math.max(0, (pool.used / total) * 100));
}

export type PoolHealth = 'ok' | 'warn' | 'critical';

export function poolHealth(percent: number | null): PoolHealth {
	if (percent === null) return 'ok';
	if (percent >= POOL_CRITICAL_PERCENT) return 'critical';
	if (percent >= POOL_WARN_PERCENT) return 'warn';
	return 'ok';
}

/**
 * The aggregate CPU figure, falling back to the mean of the per-thread entries.
 * The `cpu` key has been present on every sample observed, but averaging the
 * threads is both cheap and the right answer if it ever isn't.
 */
export function aggregateCpu(cpu: Record<string, CpuSample> | undefined): number | null {
	if (!cpu) return null;
	if (typeof cpu.cpu?.usage === 'number') return cpu.cpu.usage;
	const cores = Object.entries(cpu)
		.filter(([key]) => /^cpu\d+$/.test(key))
		.map(([, v]) => v.usage)
		.filter((n): n is number => typeof n === 'number');
	if (cores.length === 0) return null;
	return cores.reduce((a, b) => a + b, 0) / cores.length;
}

/**
 * The highest core temperature, which is the one that matters — an average
 * hides a single hot core, and a single hot core is the thing you want to know.
 */
export function peakCpuTemp(cpu: Record<string, CpuSample> | undefined): number | null {
	if (!cpu) return null;
	const temps = Object.values(cpu)
		.map((c) => c.temp)
		.filter((n): n is number => typeof n === 'number' && n > 0);
	return temps.length > 0 ? Math.max(...temps) : null;
}

/** Physical memory in use, derived — the feed reports total and available. */
export function memoryUsed(memory: RealtimeUpdate['memory']): number | null {
	const total = memory?.physical_memory_total;
	const available = memory?.physical_memory_available;
	if (typeof total !== 'number' || typeof available !== 'number') return null;
	return Math.max(0, total - available);
}
