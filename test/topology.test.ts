import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolTopology } from '../src/lib/server/storage.ts';
import {
	anyErrors,
	diskCount,
	flattenTopology,
	isHealthyState,
	poolErrors,
	subtreeErrors,
	unhealthyMembers
} from '../src/lib/storage/topology.ts';

const empty = { data: [], log: [], cache: [], spare: [], special: [], dedup: [] };

/** The real NAS layout: two RAIDZ2 vdevs of four disks. */
function nas(overrides: Record<string, Partial<{ read: number; write: number; checksum: number; status: string }>> = {}): PoolTopology {
	const disk = (name: string) => {
		const o = overrides[name] ?? {};
		return {
			type: 'DISK',
			status: o.status ?? 'ONLINE',
			name: `guid-${name}`,
			disk: name,
			guid: `g-${name}`,
			stats: {
				read_errors: o.read ?? 0,
				write_errors: o.write ?? 0,
				checksum_errors: o.checksum ?? 0
			}
		};
	};
	return {
		...empty,
		data: [
			{
				type: 'RAIDZ2',
				status: 'ONLINE',
				name: 'raidz2-0',
				guid: 'v0',
				stats: { read_errors: 0, write_errors: 0, checksum_errors: 0 },
				children: ['sdh', 'sdc', 'sdg', 'sdf'].map(disk)
			},
			{
				type: 'RAIDZ2',
				status: 'ONLINE',
				name: 'raidz2-1',
				guid: 'v1',
				stats: { read_errors: 0, write_errors: 0, checksum_errors: 0 },
				children: ['sda', 'sdb', 'sdd', 'sde'].map(disk)
			}
		]
	};
}

test('the real layout flattens to two vdevs and eight disks', () => {
	const rows = flattenTopology(nas());
	assert.equal(rows.length, 10);
	assert.equal(diskCount(nas()), 8);
	assert.equal(rows[0]?.depth, 0);
	assert.equal(rows[0]?.type, 'RAIDZ2');
	assert.equal(rows[1]?.depth, 1);
	// A member is labelled by its device name, not its partition GUID.
	assert.equal(rows[1]?.label, 'sdh');
});

test('a disk error rolls up to the pool even though the vdev reads zero', () => {
	// This is the whole point: ZFS records the error on the disk, so a
	// pool-level badge that only read the top vdev would show nothing.
	const t = nas({ sdg: { checksum: 12 } });
	assert.deepEqual(poolErrors(t), { read: 0, write: 0, checksum: 12 });
	const vdev0 = t.data[0]!;
	assert.equal(vdev0.stats?.checksum_errors, 0, 'the container itself is clean');
	assert.deepEqual(subtreeErrors(vdev0), { read: 0, write: 0, checksum: 12 });
	assert.equal(anyErrors(poolErrors(t)), true);
});

test('a clean pool reports no errors', () => {
	assert.deepEqual(poolErrors(nas()), { read: 0, write: 0, checksum: 0 });
	assert.equal(anyErrors(poolErrors(nas())), false);
});

test('errors from several disks and kinds add up', () => {
	const t = nas({ sda: { read: 2, checksum: 1 }, sde: { write: 3, checksum: 4 } });
	assert.deepEqual(poolErrors(t), { read: 2, write: 3, checksum: 5 });
});

test('a degraded member is found without drilling in', () => {
	const t = nas({ sdb: { status: 'FAULTED' } });
	const bad = unhealthyMembers(t);
	assert.equal(bad.length, 1);
	assert.equal(bad[0]?.label, 'sdb');
	assert.equal(bad[0]?.status, 'FAULTED');
});

test('ZFS member states are judged, not guessed', () => {
	assert.equal(isHealthyState('ONLINE'), true);
	assert.equal(isHealthyState('online'), true);
	assert.equal(isHealthyState('AVAIL'), true, 'a spare that is available is fine');
	assert.equal(isHealthyState('DEGRADED'), false);
	assert.equal(isHealthyState('FAULTED'), false);
	assert.equal(isHealthyState('UNAVAIL'), false);
	assert.equal(isHealthyState('OFFLINE'), false);
	// An unrecognised state must not be optimistically called healthy.
	assert.equal(isHealthyState('SOMETHING_ELSE'), false);
	assert.equal(isHealthyState(undefined), false);
});

test('missing and empty topologies are handled, not crashed on', () => {
	assert.deepEqual(flattenTopology(null), []);
	assert.deepEqual(flattenTopology(undefined), []);
	assert.deepEqual(poolErrors(null), { read: 0, write: 0, checksum: 0 });
	assert.deepEqual(flattenTopology(empty), []);
	assert.equal(diskCount(null), 0);
});

test('stats absent entirely counts as zero, not NaN', () => {
	const t = { ...empty, data: [{ type: 'DISK', status: 'ONLINE', name: 'x', disk: 'sdx' }] };
	assert.deepEqual(poolErrors(t), { read: 0, write: 0, checksum: 0 });
	assert.equal(flattenTopology(t)[0]?.label, 'sdx');
});

test('cache and log members are included, in reading order', () => {
	const t = {
		...empty,
		data: [{ type: 'DISK', status: 'ONLINE', name: 'd', disk: 'sda' }],
		log: [{ type: 'DISK', status: 'ONLINE', name: 'l', disk: 'nvme0n1' }],
		cache: [{ type: 'DISK', status: 'ONLINE', name: 'c', disk: 'nvme1n1' }]
	};
	assert.deepEqual(
		flattenTopology(t).map((r) => [r.group, r.label]),
		[
			['data', 'sda'],
			['log', 'nvme0n1'],
			['cache', 'nvme1n1']
		]
	);
});
