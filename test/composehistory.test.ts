import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComposeHistory } from '../src/lib/server/composehistory.ts';

const yaml = (n: number) => `services:\n  a:\n    image: x:${n}\n`;
const tmp = () => mkdtempSync(join(tmpdir(), 'trueweb-history-'));

test('records versions newest-first and keeps the text', () => {
	const h = new ComposeHistory();
	h.record('kuma', yaml(1));
	h.record('kuma', yaml(2));

	const list = h.list('kuma');
	assert.equal(list.length, 2);
	assert.equal(list[0]?.id, 2, 'newest first');
	assert.equal(list[1]?.id, 1);
	assert.equal(h.get('kuma', 1)?.yaml, yaml(1));
	assert.equal(h.get('kuma', 2)?.yaml, yaml(2));
});

test('does not persist unless a directory is configured', () => {
	const h = new ComposeHistory();
	h.record('kuma', yaml(1));
	assert.equal(h.persistent, false);
	assert.equal(h.diskError, '');
});

test('an unchanged compose does not push a real version off the end', () => {
	// The case that matters: a deploy fails, you retry the same YAML, and the
	// version you actually want to get back must still be there.
	const h = new ComposeHistory({ keep: 2 });
	h.record('kuma', yaml(1));
	assert.equal(h.record('kuma', yaml(1)), null, 'duplicate is refused');
	h.record('kuma', yaml(2));
	assert.equal(h.record('kuma', yaml(2)), null);
	assert.deepEqual(
		h.list('kuma').map((v) => v.id),
		[2, 1]
	);
	assert.equal(h.get('kuma', 1)?.yaml, yaml(1));
});

test('the ring drops the oldest, and ids keep climbing', () => {
	const h = new ComposeHistory({ keep: 3 });
	for (let i = 1; i <= 5; i++) h.record('kuma', yaml(i));
	assert.deepEqual(
		h.list('kuma').map((v) => v.id),
		[5, 4, 3]
	);
	assert.equal(h.get('kuma', 1), null, 'aged out');
	assert.equal(h.get('kuma', 5)?.yaml, yaml(5));
});

test('history is per app', () => {
	const h = new ComposeHistory();
	h.record('kuma', yaml(1));
	h.record('other', yaml(2));
	assert.equal(h.list('kuma').length, 1);
	assert.equal(h.get('kuma', 1)?.yaml, yaml(1));
	assert.equal(h.get('other', 1)?.yaml, yaml(2));
});

test('metadata carries size and line count, not the text', () => {
	const h = new ComposeHistory();
	h.record('kuma', yaml(1));
	const [meta] = h.list('kuma');
	assert.equal(meta?.lines, 3, 'the trailing newline is not a fourth line');
	assert.equal(meta?.bytes, Buffer.byteLength(yaml(1), 'utf8'));
	assert.equal((meta as Record<string, unknown>).yaml, undefined);
});

test('empty and whitespace-only composes are not recorded', () => {
	const h = new ComposeHistory();
	assert.equal(h.record('kuma', ''), null);
	assert.equal(h.record('kuma', '   \n  '), null);
	assert.equal(h.record('', yaml(1)), null);
	assert.equal(h.list('kuma').length, 0);
});

test('forget drops one app and leaves the others', () => {
	const h = new ComposeHistory();
	h.record('kuma', yaml(1));
	h.record('other', yaml(2));
	h.forget('kuma');
	assert.equal(h.list('kuma').length, 0);
	assert.equal(h.list('other').length, 1);
});

test('with a directory, versions survive a restart', () => {
	const dir = tmp();
	const first = new ComposeHistory({ dir });
	first.record('kuma', yaml(1));
	first.record('kuma', yaml(2));
	assert.equal(first.persistent, true);

	const second = new ComposeHistory({ dir });
	assert.deepEqual(
		second.list('kuma').map((v) => v.id),
		[2, 1]
	);
	assert.equal(second.get('kuma', 1)?.yaml, yaml(1));
	// A new record continues the ids rather than colliding with a restored one.
	assert.equal(second.record('kuma', yaml(3))?.id, 3);
});

test('the history file is not world-readable — composes hold secrets', () => {
	const dir = tmp();
	const h = new ComposeHistory({ dir });
	h.record('kuma', yaml(1));
	const mode = statSync(join(dir, 'compose-history.json')).mode & 0o777;
	assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
});

test('a corrupt history file degrades instead of throwing', () => {
	const dir = tmp();
	writeFileSync(join(dir, 'compose-history.json'), 'not json at all');
	const h = new ComposeHistory({ dir });
	assert.equal(h.list('kuma').length, 0);
	assert.notEqual(h.diskError, '', 'the reason is kept, not swallowed');
	assert.equal(h.persistent, false, 'and it stops claiming to persist');
	// Still usable in memory: a broken file must not break editing.
	assert.equal(h.record('kuma', yaml(1))?.id, 1);
	assert.equal(h.get('kuma', 1)?.yaml, yaml(1));
	// And it does not keep writing over a file it could not read.
	assert.equal(readFileSync(join(dir, 'compose-history.json'), 'utf8'), 'not json at all');
});

test('entries that are the wrong shape are dropped, not trusted', () => {
	const dir = tmp();
	writeFileSync(
		join(dir, 'compose-history.json'),
		JSON.stringify({ kuma: [{ id: 1, savedAt: 'x', yaml: yaml(1) }, { id: 'nope' }, null] })
	);
	const h = new ComposeHistory({ dir });
	assert.deepEqual(
		h.list('kuma').map((v) => v.id),
		[1]
	);
});
