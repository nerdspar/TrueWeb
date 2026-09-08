import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mntToDataset,
	poolOf,
	ancestorsOf,
	missingSegments,
	recommendKind,
	isDatasetParent
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

test('a direct child of a Data dataset is the one case that becomes a dataset', () => {
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/NAS/Data',
			missingCount: 1,
			ancestorIsMountpoint: true
		}),
		'dataset'
	);
	// Pool-agnostic: it's the parent named Data that matters, not the pool.
	assert.equal(
		recommendKind({ existingAncestor: '/mnt/tank/Data', missingCount: 1, ancestorIsMountpoint: true }),
		'dataset'
	);
});

test('anything below Data becomes a directory, not a nested dataset', () => {
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/NAS/Data',
			missingCount: 2,
			ancestorIsMountpoint: true
		}),
		'directory'
	);
	// A child of an app's own dataset is a directory, however deep.
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/NAS/Data/jellyfin',
			missingCount: 1,
			ancestorIsMountpoint: true
		}),
		'directory'
	);
});

test('datasets are not offered outside Data, even under another dataset', () => {
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/NAS/Media',
			missingCount: 1,
			ancestorIsMountpoint: true
		}),
		'directory'
	);
	assert.equal(
		recommendKind({ existingAncestor: '/mnt/NAS', missingCount: 1, ancestorIsMountpoint: true }),
		'directory'
	);
});

test('a plain directory parent never yields a dataset', () => {
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/NAS/Data',
			missingCount: 1,
			ancestorIsMountpoint: false
		}),
		'directory'
	);
	assert.equal(
		recommendKind({ existingAncestor: null, missingCount: 1, ancestorIsMountpoint: true }),
		'directory'
	);
});

test('configured dataset parents override the Data default', () => {
	const configured = ['/mnt/tank/apps'];
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/tank/apps',
			missingCount: 1,
			ancestorIsMountpoint: true,
			datasetParents: configured
		}),
		'dataset'
	);
	// With an explicit list, Data is no longer special.
	assert.equal(
		recommendKind({
			existingAncestor: '/mnt/NAS/Data',
			missingCount: 1,
			ancestorIsMountpoint: true,
			datasetParents: configured
		}),
		'directory'
	);
});

test('isDatasetParent matches on the parent name, ignoring trailing slashes', () => {
	assert.equal(isDatasetParent('/mnt/NAS/Data'), true);
	assert.equal(isDatasetParent('/mnt/NAS/Data/'), true);
	assert.equal(isDatasetParent('/mnt/NAS/data'), false, 'case matters on ZFS');
	assert.equal(isDatasetParent('/mnt/NAS/Media'), false);
	assert.equal(isDatasetParent('/mnt/NAS/Data', ['/mnt/other']), false);
});
