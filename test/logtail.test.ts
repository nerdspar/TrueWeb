import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTail, MAX_TAIL_BYTES } from '../src/lib/server/logtail.ts';

async function withFile(contents: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'trueweb-log-'));
	const path = join(dir, 'app_lifecycle.log');
	await writeFile(path, contents, 'utf8');
	return path;
}

const SAMPLE = [
	'19:00:01 INFO  [uptime-kuma-2] pulling images',
	'19:00:05 INFO  [other-app] starting',
	'19:00:09 ERROR [uptime-kuma-2] failed to create container: permission denied on /mnt/NAS/Data',
	'19:00:10 INFO  [other-app] started',
	''
].join('\n');

test('a missing file is reported, not thrown', async () => {
	const r = await readTail('/definitely/not/here/app_lifecycle.log');
	assert.equal(r.available, false);
	assert.match(r.reason ?? '', /isn't visible/);
	assert.deepEqual(r.lines, []);
});

test('a directory is not mistaken for a log', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'trueweb-log-'));
	await mkdir(join(dir, 'sub'));
	const r = await readTail(join(dir, 'sub'));
	assert.equal(r.available, false);
	assert.match(r.reason ?? '', /not a file/);
});

test('reads the tail and drops blank lines', async () => {
	const r = await readTail(await withFile(SAMPLE));
	assert.equal(r.available, true);
	assert.equal(r.filtered, false);
	assert.equal(r.lines.length, 4);
	assert.match(r.lines[0] ?? '', /pulling images/);
});

test('narrows to the lines mentioning an app', async () => {
	const r = await readTail(await withFile(SAMPLE), { app: 'uptime-kuma-2' });
	assert.equal(r.filtered, true);
	assert.equal(r.lines.length, 2);
	assert.ok(r.lines.every((l) => l.includes('uptime-kuma-2')));
	assert.match(r.lines[1] ?? '', /permission denied/);
});

test('falls back to the plain tail when the app is never mentioned', async () => {
	const r = await readTail(await withFile(SAMPLE), { app: 'no-such-app' });
	assert.equal(r.filtered, false, 'better a broad tail than nothing at all');
	assert.equal(r.lines.length, 4);
});

test('honours the line limit, keeping the newest', async () => {
	const many = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
	const r = await readTail(await withFile(many), { lines: 5 });
	assert.deepEqual(r.lines, ['line 495', 'line 496', 'line 497', 'line 498', 'line 499']);
});

test('caps how much is read and drops the partial first line', async () => {
	// Each line is padded so the file comfortably exceeds a tiny cap.
	const lines = Array.from({ length: 200 }, (_, i) => `${String(i).padStart(4, '0')} ${'x'.repeat(60)}`);
	const r = await readTail(await withFile(`${lines.join('\n')}\n`), {
		lines: 2000,
		maxBytes: 1024
	});
	assert.equal(r.available, true);
	// Only the tail is present, and no truncated fragment leads it.
	assert.ok(r.lines.length < 200, 'should not have read the whole file');
	assert.match(r.lines[0] ?? '', /^\d{4} x+$/, 'first line must be whole');
	assert.match(r.lines.at(-1) ?? '', /^0199 /);
});

test('an empty file reads as available with nothing in it', async () => {
	const r = await readTail(await withFile(''));
	assert.equal(r.available, true);
	assert.deepEqual(r.lines, []);
});

test('the default cap is a sane size', () => {
	assert.equal(MAX_TAIL_BYTES, 256 * 1024);
});
