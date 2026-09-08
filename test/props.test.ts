import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildTree,
	hasQuota,
	propNumber,
	propText,
	visibleNodes,
	type DatasetRow
} from '../src/lib/datasets/props.ts';

test('a byte property yields its number and TrueNAS own text', () => {
	// Verbatim from the box.
	const used = {
		parsed: 15490471254720,
		rawvalue: '15490471254720',
		value: '14.09 TiB',
		source: 'NONE'
	};
	assert.equal(propNumber(used), 15490471254720);
	// TiB, not the "14 TB" a naive 1024-based formatter labels it.
	assert.equal(propText(used), '14.09 TiB');
});

test('a ratio parses from its numeric string', () => {
	const ratio = { parsed: '1.03', rawvalue: '1.03', value: '1.03x' };
	assert.equal(propNumber(ratio), 1.03);
	assert.equal(propText(ratio), '1.03x');
});

test('a non-numeric property does not pretend to be a number', () => {
	const compression = { parsed: 'lz4', rawvalue: 'lz4', value: 'LZ4' };
	assert.equal(propNumber(compression), null);
	assert.equal(propText(compression), 'LZ4');
});

test('an unset quota is recognised as unset, not as zero', () => {
	// This is the shape that breaks naive checks: parsed null, rawvalue "0".
	const none = { parsed: null, rawvalue: '0', value: null, source: 'DEFAULT' };
	assert.equal(propNumber(none), 0, 'rawvalue is the only number present');
	assert.equal(hasQuota(none), false);
	assert.equal(propText(none), '0');

	const set = { parsed: 107374182400, rawvalue: '107374182400', value: '100 GiB' };
	assert.equal(hasQuota(set), true);
	assert.equal(propText(set), '100 GiB');
});

test('missing properties degrade to null and empty string', () => {
	assert.equal(propNumber(undefined), null);
	assert.equal(propNumber(null), null);
	assert.equal(propNumber({}), null);
	assert.equal(propText(undefined), '');
	assert.equal(propText({}), '');
	// Never render the words "null" or "undefined" at a user.
	assert.equal(propText({ value: null, parsed: null, rawvalue: null }), '');
	assert.equal(hasQuota(undefined), false);
});

const row = (name: string): DatasetRow => ({ id: name, name, type: 'FILESYSTEM' });

test('the flat list becomes a tree', () => {
	const roots = buildTree([
		row('NAS/Data/crate'),
		row('NAS'),
		row('NAS/Data'),
		row('NAS/Apps')
	]);
	assert.equal(roots.length, 1);
	assert.equal(roots[0]?.row.name, 'NAS');
	assert.equal(roots[0]?.depth, 0);
	assert.equal(roots[0]?.children.length, 2);
	const dataNode = roots[0]?.children.find((c) => c.label === 'Data');
	assert.equal(dataNode?.depth, 1);
	assert.equal(dataNode?.children[0]?.label, 'crate');
	assert.equal(dataNode?.children[0]?.depth, 2);
});

test('several pools each get their own root', () => {
	const roots = buildTree([row('NAS'), row('boot-pool'), row('NAS/Data')]);
	assert.deepEqual(
		roots.map((r) => r.row.name).sort(),
		['NAS', 'boot-pool']
	);
});

test('a dataset whose parent was not returned still appears', () => {
	// A filtered query can return a child without its parent; it must not vanish.
	const roots = buildTree([row('NAS/Data/crate')]);
	assert.equal(roots.length, 1);
	assert.equal(roots[0]?.label, 'crate');
});

test('only expanded branches are visible', () => {
	const roots = buildTree([row('NAS'), row('NAS/Data'), row('NAS/Data/crate'), row('NAS/Apps')]);
	assert.deepEqual(
		visibleNodes(roots, new Set()).map((n) => n.row.name),
		['NAS']
	);
	assert.deepEqual(
		visibleNodes(roots, new Set(['NAS'])).map((n) => n.row.name),
		['NAS', 'NAS/Apps', 'NAS/Data']
	);
	assert.deepEqual(
		visibleNodes(roots, new Set(['NAS', 'NAS/Data'])).map((n) => n.row.name),
		['NAS', 'NAS/Apps', 'NAS/Data', 'NAS/Data/crate']
	);
});

test('siblings are listed alphabetically', () => {
	const roots = buildTree([row('NAS'), row('NAS/zulu'), row('NAS/alpha'), row('NAS/Mike')]);
	assert.deepEqual(
		visibleNodes(roots, new Set(['NAS'])).map((n) => n.label),
		['NAS', 'alpha', 'Mike', 'zulu']
	);
});

test('an empty list is not an error', () => {
	assert.deepEqual(buildTree([]), []);
	assert.deepEqual(visibleNodes([], new Set()), []);
});
