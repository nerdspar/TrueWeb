/**
 * The `reporting.realtime` payload (§5.4).
 *
 * The API reference documents the *methods* well but not this event's body, so
 * these names were read off the live feed from a 25.10.4 box and are what the
 * middleware actually sends. Everything is optional: the shape varies with
 * hardware (core count, NIC names, pool names), and a field that exists on one
 * box is not a field that exists on every box.
 */

import { alertIso } from "./alerts.ts";

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
  if (typeof pool.used !== "number") return null;
  // The fallback needs `available` to be present, not merely absent-as-zero:
  // with only `used` known the pool's size is unknown, and treating that as
  // "100% full" would fire the capacity warning on missing data.
  const total =
    typeof pool.total === "number"
      ? pool.total
      : typeof pool.available === "number"
        ? pool.used + pool.available
        : null;
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, (pool.used / total) * 100));
}

export type PoolHealth = "ok" | "warn" | "critical";

export function poolHealth(percent: number | null): PoolHealth {
  if (percent === null) return "ok";
  if (percent >= POOL_CRITICAL_PERCENT) return "critical";
  if (percent >= POOL_WARN_PERCENT) return "warn";
  return "ok";
}

/**
 * The aggregate CPU figure, falling back to the mean of the per-thread entries.
 * The `cpu` key has been present on every sample observed, but averaging the
 * threads is both cheap and the right answer if it ever isn't.
 */
export function aggregateCpu(
  cpu: Record<string, CpuSample> | undefined,
): number | null {
  if (!cpu) return null;
  if (typeof cpu.cpu?.usage === "number") return cpu.cpu.usage;
  const cores = Object.entries(cpu)
    .filter(([key]) => /^cpu\d+$/.test(key))
    .map(([, v]) => v.usage)
    .filter((n): n is number => typeof n === "number");
  if (cores.length === 0) return null;
  return cores.reduce((a, b) => a + b, 0) / cores.length;
}

/**
 * The highest core temperature, which is the one that matters — an average
 * hides a single hot core, and a single hot core is the thing you want to know.
 */
export function peakCpuTemp(
  cpu: Record<string, CpuSample> | undefined,
): number | null {
  if (!cpu) return null;
  const temps = Object.values(cpu)
    .map((c) => c.temp)
    .filter((n): n is number => typeof n === "number" && n > 0);
  return temps.length > 0 ? Math.max(...temps) : null;
}

/** Physical memory in use, derived — the feed reports total and available. */
export function memoryUsed(memory: RealtimeUpdate["memory"]): number | null {
  const total = memory?.physical_memory_total;
  const available = memory?.physical_memory_available;
  if (typeof total !== "number" || typeof available !== "number") return null;
  return Math.max(0, total - available);
}

/**
 * Memory split the way TrueNAS's own dashboard splits it: free, ZFS cache, and
 * everything else.
 *
 * This matters more than it looks. `physical_memory_available` is genuinely
 * free memory — on this box it reads ~3.4 GiB of 30.7 GiB — so a plain
 * "used of total" meter renders 90%+ and looks like an emergency. It isn't:
 * most of what's missing is ARC, which ZFS hands back the moment something
 * else wants it. Showing the three parts is the difference between a number
 * that alarms and a number that informs.
 *
 * Services is derived rather than reported: total − free − cache. The middleware
 * sends no such field, and the three it does send add up to the total.
 */
export type MemoryBreakdown = {
  total: number;
  free: number;
  cache: number;
  services: number;
};

export function memoryBreakdown(
  memory: RealtimeUpdate["memory"],
): MemoryBreakdown | null {
  const total = memory?.physical_memory_total;
  const free = memory?.physical_memory_available;
  if (typeof total !== "number" || typeof free !== "number" || total <= 0)
    return null;
  const cache = typeof memory?.arc_size === "number" ? memory.arc_size : 0;
  // Clamped: the three samples aren't taken at the same instant, so a tiny
  // negative remainder is possible and would render as "-0 B".
  const services = Math.max(0, total - free - cache);
  return { total, free, cache, services };
}

/** Per-thread entries only — the `cpu` key is the aggregate, not a thread. */
function threads(
  cpu: Record<string, CpuSample> | undefined,
): [number, CpuSample][] {
  return Object.entries(cpu ?? {})
    .map(([key, sample]) => [/^cpu(\d+)$/.exec(key), sample] as const)
    .filter(([m]) => m !== null)
    .map(([m, sample]) => [Number(m![1]), sample]);
}

/**
 * The busiest single thread. An aggregate of 1% can hide one thread pinned at
 * 100%, which is what a stuck single-threaded job looks like from outside.
 *
 * Numbered 1-based to match what TrueNAS's own dashboard calls them, so the two
 * don't disagree about which thread is hot.
 */
export function peakCpuThread(
  cpu: Record<string, CpuSample> | undefined,
): { thread: number; usage: number } | null {
  let best: { thread: number; usage: number } | null = null;
  for (const [index, sample] of threads(cpu)) {
    if (typeof sample.usage !== "number") continue;
    if (!best || sample.usage > best.usage)
      best = { thread: index + 1, usage: sample.usage };
  }
  return best;
}

/**
 * The hottest thread temperature and how many threads report it.
 *
 * The count is not padding: AMD chips like this one expose a single package
 * sensor that every thread repeats, so "43°C on all 12" and "43°C on one of 12"
 * are different situations and only the count tells them apart.
 */
export function hottestCpu(
  cpu: Record<string, CpuSample> | undefined,
): { temp: number; count: number; total: number } | null {
  const temps = threads(cpu)
    .map(([, s]) => s.temp)
    .filter((n): n is number => typeof n === "number" && n > 0);
  if (temps.length === 0) return null;
  const temp = Math.max(...temps);
  return {
    temp,
    count: temps.filter((t) => t === temp).length,
    total: temps.length,
  };
}

/**
 * How long a finished scrub or resilver took, in seconds.
 *
 * The middleware reports start and end instants but never a duration, and the
 * duration is the interesting half: a scrub that suddenly takes twice as long
 * as last month is an early read on a disk going soft.
 */
export function scanDuration(scan: {
  start_time?: { $date: number } | string | null;
  end_time?: { $date: number } | string | null;
}): number | null {
  const start = alertIso(scan.start_time ?? undefined);
  const end = alertIso(scan.end_time ?? undefined);
  if (!start || !end) return null;
  const seconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return seconds >= 0 ? seconds : null;
}
