import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	aggregateCpu,
	memoryUsed,
	peakCpuTemp,
	poolHealth,
	poolUsedPercent
} from '../src/lib/dashboard/types.ts';
import { formatRate, formatUptime } from '../src/lib/client/actions.ts';

test('pool fullness comes from used and total', () => {
	// The real numbers off the box: NAS is ~90% full, which is the case the
	// warning exists for.
	assert.equal(
		Math.round(poolUsedPercent({ used: 15490446113472, total: 17288909653120 }) ?? 0),
		90
	);
	assert.equal(poolUsedPercent({ used: 50, total: 100 }), 50);
});

test('fullness falls back to used + available when total is absent', () => {
	assert.equal(poolUsedPercent({ used: 25, available: 75 }), 25);
});

test('unusable numbers give null rather than a wrong bar', () => {
	assert.equal(poolUsedPercent({}), null);
	assert.equal(poolUsedPercent({ used: 10 }), null);
	assert.equal(poolUsedPercent({ used: 10, total: 0 }), null);
});

test('a nearly full pool is called out, not just coloured', () => {
	assert.equal(poolHealth(12), 'ok');
	assert.equal(poolHealth(79.9), 'ok');
	assert.equal(poolHealth(80), 'warn');
	assert.equal(poolHealth(89.9), 'warn');
	assert.equal(poolHealth(90), 'critical');
	assert.equal(poolHealth(null), 'ok', 'unknown is not an alarm');
});

test('CPU uses the aggregate when the feed sends one', () => {
	assert.equal(aggregateCpu({ cpu: { usage: 6 }, cpu0: { usage: 90 } }), 6);
});

test('CPU falls back to the mean of the threads', () => {
	assert.equal(aggregateCpu({ cpu0: { usage: 10 }, cpu1: { usage: 20 } }), 15);
	// A per-core entry without a usage figure must not drag the mean to zero.
	assert.equal(aggregateCpu({ cpu0: { usage: 10 }, cpu1: { temp: 40 } }), 10);
	assert.equal(aggregateCpu({}), null);
	assert.equal(aggregateCpu(undefined), null);
});

test('the hottest core is the one reported', () => {
	assert.equal(peakCpuTemp({ cpu: { temp: 42 }, cpu0: { temp: 42 }, cpu1: { temp: 67 } }), 67);
	// Zero means "no reading" on this feed, not a cold core.
	assert.equal(peakCpuTemp({ cpu0: { temp: 0 } }), null);
	assert.equal(peakCpuTemp(undefined), null);
});

test('memory in use is derived from total and available', () => {
	assert.equal(
		memoryUsed({ physical_memory_total: 32915546112, physical_memory_available: 10244141056 }),
		22671405056
	);
	assert.equal(memoryUsed({ physical_memory_total: 100 }), null);
	assert.equal(memoryUsed(undefined), null);
});

test('rates and uptime read as a human would write them', () => {
	assert.equal(formatRate(2966), '2.9 KB/s');
	assert.equal(formatRate(undefined), '—');
	assert.equal(formatUptime(0), '0s');
	assert.equal(formatUptime(45), '45s');
	assert.equal(formatUptime(600), '10m');
	assert.equal(formatUptime(3660), '1h 1m');
	assert.equal(formatUptime(90000), '1d 1h');
	assert.equal(formatUptime(86400), '1d');
	assert.equal(formatUptime(undefined), '—');
});
