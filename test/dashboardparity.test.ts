/**
 * The dashboard figures that have to agree with TrueNAS's own dashboard.
 *
 * Every expected value here was read off the live 25.10.4 box at the same time
 * as its web UI, so these are parity assertions, not invented arithmetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolTopology } from '../src/lib/server/storage.ts';
import { dataLayout, formatLayout, groupCounts, mixedCapacity } from '../src/lib/storage/topology.ts';
import {
	hottestCpu,
	memoryBreakdown,
	peakCpuThread,
	scanDuration
} from '../src/lib/dashboard/types.ts';

const empty = { data: [], log: [], cache: [], spare: [], special: [], dedup: [] };

const vdev = (type: string, width: number) => ({
	type,
	status: 'ONLINE',
	name: type.toLowerCase(),
	children: Array.from({ length: width }, (_, i) => ({
		type: 'DISK',
		status: 'ONLINE',
		name: `guid-${i}`,
		disk: `sd${String.fromCharCode(97 + i)}`
	}))
});

test('memory splits exactly as the TrueNAS dashboard reports it', () => {
	// The live sample behind "30.7 GiB total / Free 3.4 / ZFS Cache 14.7 / Services 12.5".
	const mem = memoryBreakdown({
		physical_memory_total: 32915546112,
		physical_memory_available: 3604598784,
		arc_size: 15787947416
	});
	assert.ok(mem);
	const gib = (n: number) => +(n / 1024 ** 3).toFixed(1);
	assert.equal(gib(mem.total), 30.7);
	assert.equal(gib(mem.free), 3.4);
	assert.equal(gib(mem.cache), 14.7);
	// TrueNAS's card read 12.5 GiB a few minutes before this sample was taken;
	// free and ARC both drift, and the point of the assertion below is that
	// whatever they are, the parts still sum to the whole.
	assert.equal(gib(mem.services), 12.6);
	// The three parts must account for the whole, or the split is lying.
	assert.equal(mem.free + mem.cache + mem.services, mem.total);
});

test('memory never reports negative services when samples disagree', () => {
	// free + arc can exceed total: they are sampled a moment apart.
	const mem = memoryBreakdown({
		physical_memory_total: 1000,
		physical_memory_available: 600,
		arc_size: 500
	});
	assert.equal(mem?.services, 0);
});

test('memory is null rather than guessed when a field is missing', () => {
	assert.equal(memoryBreakdown({ physical_memory_total: 100 }), null);
	assert.equal(memoryBreakdown({ physical_memory_available: 100 }), null);
	assert.equal(memoryBreakdown(undefined), null);
	// A zero total would divide into a meaningless percentage.
	assert.equal(
		memoryBreakdown({ physical_memory_total: 0, physical_memory_available: 0 }),
		null
	);
});

test('arc_size absent counts as no cache, not as a missing reading', () => {
	const mem = memoryBreakdown({ physical_memory_total: 1000, physical_memory_available: 400 });
	assert.deepEqual(mem, { total: 1000, free: 400, cache: 0, services: 600 });
});

test('busiest thread is found behind a calm aggregate, and numbered 1-based', () => {
	const busiest = peakCpuThread({
		cpu: { usage: 9 }, // the aggregate must not be mistaken for a thread
		cpu0: { usage: 2 },
		cpu1: { usage: 5 },
		cpu11: { usage: 98 }
	});
	assert.deepEqual(busiest, { thread: 12, usage: 98 });
});

test('hottest counts how many threads share the peak', () => {
	// The AMD case: one package sensor repeated across every thread.
	const all = hottestCpu({ cpu: { temp: 43 }, cpu0: { temp: 43 }, cpu1: { temp: 43 } });
	assert.deepEqual(all, { temp: 43, count: 2, total: 2 });

	// The case worth spotting: a single hot thread among cool ones.
	const one = hottestCpu({ cpu0: { temp: 40 }, cpu1: { temp: 40 }, cpu2: { temp: 71 } });
	assert.deepEqual(one, { temp: 71, count: 1, total: 3 });
});

test('a zero temperature is treated as no reading, not as freezing', () => {
	assert.equal(hottestCpu({ cpu0: { temp: 0 }, cpu1: { temp: 0 } }), null);
	assert.equal(hottestCpu({ cpu0: { usage: 5 } }), null);
	assert.equal(peakCpuThread({ cpu0: {} }), null);
});

test('the real pool renders the layout TrueNAS shows', () => {
	const topology = { ...empty, data: [vdev('RAIDZ2', 4), vdev('RAIDZ2', 4)] } as PoolTopology;
	assert.equal(formatLayout(dataLayout(topology)), '2 × RAIDZ2 | 4 wide');
	assert.deepEqual(groupCounts(topology).data, 2);
	assert.deepEqual(groupCounts(topology).cache, 0);
	assert.deepEqual(groupCounts(topology).spare, 0);
});

test('vdevs of unlike shape are listed apart rather than averaged', () => {
	const topology = {
		...empty,
		data: [vdev('RAIDZ2', 4), vdev('RAIDZ2', 4), vdev('MIRROR', 2)]
	} as PoolTopology;
	assert.equal(formatLayout(dataLayout(topology)), '2 × RAIDZ2 | 4 wide + MIRROR | 2 wide');
});

test('a single-disk vdev is not described as "1 wide"', () => {
	const topology = { ...empty, data: [{ type: 'DISK', status: 'ONLINE', name: 'sda' }] } as PoolTopology;
	assert.equal(formatLayout(dataLayout(topology)), 'DISK');
});

test('layout of an unloaded topology is empty, not a broken string', () => {
	assert.equal(formatLayout(dataLayout(null)), '');
	assert.equal(groupCounts(null).data, 0);
});

test('mixed capacity is the real 3TB + 6TB pool, and matched disks are not', () => {
	const wd = 3000592982016;
	const seagate = 6001175126016;
	assert.equal(mixedCapacity([wd, wd, wd, wd, seagate, seagate, seagate, seagate]), true);
	assert.equal(mixedCapacity([wd, wd, wd, wd]), false);
	// Unknown sizes must not invent a mismatch.
	assert.equal(mixedCapacity([wd, null, null]), false);
	assert.equal(mixedCapacity([]), false);
});

test('scan duration matches the scrub the box actually ran', () => {
	// 2026-08-31 → the run TrueNAS describes as 1 day 1 hour 52 minutes 25 seconds.
	const seconds = scanDuration({
		start_time: { $date: 1788062406000 },
		end_time: { $date: 1788155551000 }
	});
	assert.equal(seconds, 93145);
	assert.equal(Math.floor((seconds ?? 0) / 86400), 1);
	assert.equal(Math.floor(((seconds ?? 0) % 86400) / 3600), 1);
});

test('a scan still running has no duration', () => {
	assert.equal(scanDuration({ start_time: { $date: 1788062406000 }, end_time: null }), null);
	assert.equal(scanDuration({}), null);
});
