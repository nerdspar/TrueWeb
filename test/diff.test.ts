import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, summarise, countChanges } from '../src/lib/compose/diff.ts';

const render = (d: ReturnType<typeof diffLines>) =>
	d.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'remove' ? '-' : ' '}${l.text}`);

test('identical text has no changes', () => {
	const d = diffLines('a\nb\nc\n', 'a\nb\nc\n');
	assert.deepEqual(countChanges(d), { added: 0, removed: 0 });
	assert.ok(d.every((l) => l.kind === 'same'));
});

test('a changed line shows as one removal and one addition', () => {
	const d = diffLines('a\nb\nc\n', 'a\nB\nc\n');
	assert.deepEqual(render(d), [' a', '-b', '+B', ' c']);
	assert.deepEqual(countChanges(d), { added: 1, removed: 1 });
});

test('an inserted line is only an addition', () => {
	const d = diffLines('a\nc\n', 'a\nb\nc\n');
	assert.deepEqual(render(d), [' a', '+b', ' c']);
	assert.deepEqual(countChanges(d), { added: 1, removed: 0 });
});

test('a deleted line is only a removal', () => {
	const d = diffLines('a\nb\nc\n', 'a\nc\n');
	assert.deepEqual(render(d), [' a', '-b', ' c']);
	assert.deepEqual(countChanges(d), { added: 0, removed: 1 });
});

test('line numbers point at the right side of the change', () => {
	const d = diffLines('a\nb\n', 'a\nB\n');
	const removed = d.find((l) => l.kind === 'remove');
	const added = d.find((l) => l.kind === 'add');
	assert.equal(removed?.oldLine, 2);
	assert.equal(removed?.newLine, undefined);
	assert.equal(added?.newLine, 2);
	assert.equal(added?.oldLine, undefined);
});

test('a realistic compose edit reads as the one line that changed', () => {
	const before = 'services:\n  web:\n    image: nginx:1.25\n    ports:\n      - "8080:80"\n';
	const after = 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n';
	const d = diffLines(before, after);
	assert.deepEqual(countChanges(d), { added: 1, removed: 1 });
	assert.match(d.find((l) => l.kind === 'remove')?.text ?? '', /nginx:1\.25/);
	assert.match(d.find((l) => l.kind === 'add')?.text ?? '', /nginx:1\.27/);
});

test('empty to content is all additions, and back again all removals', () => {
	assert.deepEqual(countChanges(diffLines('', 'a\nb\n')), { added: 2, removed: 0 });
	assert.deepEqual(countChanges(diffLines('a\nb\n', '')), { added: 0, removed: 2 });
});

test('a trailing newline alone is not a change', () => {
	assert.deepEqual(countChanges(diffLines('a\nb', 'a\nb\n')), { added: 0, removed: 0 });
});

test('summarise keeps the changes plus context and drops the rest', () => {
	const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
	const after = before.replace('line 20', 'line 20 CHANGED');
	const full = diffLines(before, after);
	const brief = summarise(full, 2);

	assert.ok(brief.length < full.length, 'should be shorter than the whole file');
	assert.ok(brief.some((l) => l.kind === 'add' && l.text.includes('CHANGED')));
	// Context either side is retained.
	assert.ok(brief.some((l) => l.text === 'line 18'));
	assert.ok(brief.some((l) => l.text === 'line 22'));
	// Far-away lines are not.
	assert.ok(!brief.some((l) => l.text === 'line 5'));
});

test('summarise on an unchanged file yields nothing', () => {
	assert.deepEqual(summarise(diffLines('a\nb\n', 'a\nb\n')), []);
});
