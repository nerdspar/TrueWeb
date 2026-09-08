import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mntToDataset,
	poolOf,
	ancestorsOf,
	missingSegments,
	recommendKind,
	canCreateDatasetAt
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

test('a dataset is offered anywhere its parent is a dataset', () => {
	for (const ancestor of ['/mnt/NAS/Data', '/mnt/NAS/Media', '/mnt/NAS', '/mnt/NAS/Data/jellyfin']) {
		const shape = { existingAncestor: ancestor, missingCount: 1, ancestorIsMountpoint: true };
		assert.equal(canCreateDatasetAt(shape), true, ancestor);
		assert.equal(recommendKind(shape), 'dataset', ancestor);
	}
});

test('a dataset needs its immediate parent to exist, so two missing levels fall back', () => {
	// ZFS can't create pool/a/b when pool/a isn't there yet — make the
	// intermediate one first, then the child.
	const shape = { existingAncestor: '/mnt/NAS/Data', missingCount: 2, ancestorIsMountpoint: true };
	assert.equal(canCreateDatasetAt(shape), false);
	assert.equal(recommendKind(shape), 'directory');
});

test('a plain directory parent cannot hold a dataset', () => {
	const shape = { existingAncestor: '/mnt/NAS/Data/foo', missingCount: 1, ancestorIsMountpoint: false };
	assert.equal(canCreateDatasetAt(shape), false);
	assert.equal(recommendKind(shape), 'directory');
});

test('with no existing ancestor nothing can be created as a dataset', () => {
	const shape = { existingAncestor: null, missingCount: 1, ancestorIsMountpoint: true };
	assert.equal(canCreateDatasetAt(shape), false);
	assert.equal(recommendKind(shape), 'directory');
});
