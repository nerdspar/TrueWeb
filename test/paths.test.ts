import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mntToDataset,
	poolOf,
	ancestorsOf,
	missingSegments,
	recommendKind
} from '../src/lib/compose/paths.ts';

test('converts a /mnt path to the ZFS dataset name pool.dataset.create wants', () => {
	assert.equal(mntToDataset('/mnt/NAS/Data/foo'), 'NAS/Data/foo');
	assert.equal(mntToDataset('/mnt/NAS/Data/foo/'), 'NAS/Data/foo');
	// A pool root is not a creatable dataset, and non-/mnt paths aren't ours.
	assert.equal(mntToDataset('/mnt/NAS'), null);
	assert.equal(mntToDataset('/srv/data'), null);
	assert.equal(mntToDataset('/mnt/'), null);
});

test('identifies the pool', () => {
	assert.equal(poolOf('/mnt/NAS/Data/foo'), 'NAS');
	assert.equal(poolOf('/mnt/tank'), 'tank');
	assert.equal(poolOf('/etc/passwd'), null);
});

test('ancestors are deepest-first and stop at the pool root', () => {
	assert.deepEqual(ancestorsOf('/mnt/NAS/Data/apps/foo'), [
		'/mnt/NAS/Data/apps',
		'/mnt/NAS/Data',
		'/mnt/NAS'
	]);
	// A direct child of the pool has just the pool root above it.
	assert.deepEqual(ancestorsOf('/mnt/NAS/foo'), ['/mnt/NAS']);
	assert.deepEqual(ancestorsOf('/mnt/NAS'), []);
});

test('missing segments are those below the existing ancestor', () => {
	assert.deepEqual(missingSegments('/mnt/NAS/Data/foo', '/mnt/NAS/Data'), ['foo']);
	assert.deepEqual(missingSegments('/mnt/NAS/Data/a/b/c', '/mnt/NAS/Data'), ['a', 'b', 'c']);
	assert.deepEqual(missingSegments('/mnt/NAS/Data/foo/', '/mnt/NAS/Data/'), ['foo']);
	// Unrelated ancestor yields nothing rather than nonsense.
	assert.deepEqual(missingSegments('/mnt/NAS/Data/foo', '/mnt/OTHER'), []);
});

test('recommendation: a single segment under a dataset becomes a dataset', () => {
	assert.equal(recommendKind({ missingCount: 1, ancestorIsMountpoint: true }), 'dataset');
});

test('recommendation: anything deeper, or under a plain directory, becomes a directory', () => {
	assert.equal(recommendKind({ missingCount: 2, ancestorIsMountpoint: true }), 'directory');
	assert.equal(recommendKind({ missingCount: 1, ancestorIsMountpoint: false }), 'directory');
	assert.equal(recommendKind({ missingCount: 3, ancestorIsMountpoint: false }), 'directory');
});
