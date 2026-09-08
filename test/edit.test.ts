import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceVolumeSource, replaceHostPort } from '../src/lib/compose/edit.ts';
import { inspectCompose } from '../src/lib/compose/inspect.ts';

test('rewrites a relative short-syntax bind, keeping the container path', () => {
	const before = 'services:\n  a:\n    image: x\n    volumes:\n      - ./data:/app/data\n';
	const { text, replaced } = replaceVolumeSource(before, './data', '/mnt/NAS/Data/kuma');
	assert.equal(replaced, 1);
	assert.match(text, /- \/mnt\/NAS\/Data\/kuma:\/app\/data/);
	assert.equal(inspectCompose(text).hostPaths[0], '/mnt/NAS/Data/kuma');
});

test('preserves quotes and a trailing mode flag', () => {
	const before = 'services:\n  a:\n    image: x\n    volumes:\n      - "./data:/app/data:ro"\n';
	const { text } = replaceVolumeSource(before, './data', '/mnt/NAS/Data/kuma');
	assert.match(text, /- "\/mnt\/NAS\/Data\/kuma:\/app\/data:ro"/);
});

test('rewrites the long syntax source key', () => {
	const before =
		'services:\n  a:\n    image: x\n    volumes:\n      - type: bind\n        source: /mnt/OLD/x\n        target: /data\n';
	const { text, replaced } = replaceVolumeSource(before, '/mnt/OLD/x', '/mnt/NAS/Data/new');
	assert.equal(replaced, 1);
	assert.match(text, /source: \/mnt\/NAS\/Data\/new/);
	assert.match(text, /target: \/data/);
	assert.equal(inspectCompose(text).hostPaths[0], '/mnt/NAS/Data/new');
});

test('a path containing spaces is rewritten intact', () => {
	const before =
		'services:\n  a:\n    image: x\n    volumes:\n      - /mnt/AMNYA Pool/Apps/Thing:/config\n';
	const { text, replaced } = replaceVolumeSource(
		before,
		'/mnt/AMNYA Pool/Apps/Thing',
		'/mnt/NAS/Data/thing'
	);
	assert.equal(replaced, 1);
	assert.match(text, /- \/mnt\/NAS\/Data\/thing:\/config/);
	assert.deepEqual(inspectCompose(text).hostPaths, ['/mnt/NAS/Data/thing']);
});

test('replaces every occurrence across services', () => {
	const before =
		'services:\n  a:\n    image: x\n    volumes:\n      - ./data:/a\n  b:\n    image: y\n    volumes:\n      - ./data:/b\n';
	const { replaced, text } = replaceVolumeSource(before, './data', '/mnt/NAS/Data/shared');
	assert.equal(replaced, 2);
	assert.equal((text.match(/\/mnt\/NAS\/Data\/shared/g) ?? []).length, 2);
});

test('does not touch a container path that happens to match, or other keys', () => {
	// `/data` appears as a *target* and inside an env value; neither is a source.
	const before =
		'services:\n  a:\n    image: x\n    environment:\n      DIR: /data\n    volumes:\n      - /mnt/NAS/Data/a:/data\n';
	const { text, replaced } = replaceVolumeSource(before, '/data', '/mnt/NEW');
	assert.equal(replaced, 0, 'a target path is not a bind source');
	assert.equal(text, before);
});

test('regex-special characters in a path are treated literally', () => {
	const before = 'services:\n  a:\n    image: x\n    volumes:\n      - ./a+b(c):/x\n';
	const { text, replaced } = replaceVolumeSource(before, './a+b(c)', '/mnt/NAS/Data/ok');
	assert.equal(replaced, 1);
	assert.match(text, /- \/mnt\/NAS\/Data\/ok:\/x/);
});

test('a no-op replacement reports nothing changed', () => {
	const before = 'services:\n  a:\n    volumes:\n      - ./data:/x\n';
	assert.deepEqual(replaceVolumeSource(before, './data', './data'), { text: before, replaced: 0 });
	assert.equal(replaceVolumeSource(before, '', '/mnt/x').replaced, 0);
});

/* ─────────────────────────────── host ports ──────────────────────────────── */

test('changes the host port in short syntax, leaving the container port alone', () => {
	const before = 'services:\n  a:\n    image: x\n    ports:\n      - "8080:80"\n';
	const { text, replaced } = replaceHostPort(before, 8080, 8090);
	assert.equal(replaced, 1);
	assert.match(text, /- "8090:80"/);
	assert.deepEqual(inspectCompose(text).hostPorts, [8090]);
});

test('keeps a bind address and a protocol suffix', () => {
	const before =
		'services:\n  a:\n    image: x\n    ports:\n      - 127.0.0.1:8080:80\n      - "5353:53/udp"\n';
	let out = replaceHostPort(before, 8080, 9090).text;
	out = replaceHostPort(out, 5353, 5354).text;
	assert.match(out, /- 127\.0\.0\.1:9090:80/);
	assert.match(out, /- "5354:53\/udp"/);
	assert.deepEqual(inspectCompose(out).hostPorts, [5354, 9090]);
});

test('changes the long syntax published port', () => {
	const before =
		'services:\n  a:\n    image: x\n    ports:\n      - target: 8000\n        published: 18000\n';
	const { text, replaced } = replaceHostPort(before, 18000, 18001);
	assert.equal(replaced, 1);
	assert.match(text, /published: 18001/);
	assert.match(text, /target: 8000/, 'the container target is untouched');
	assert.deepEqual(inspectCompose(text).hostPorts, [18001]);
});

test('a container port of the same number is not rewritten', () => {
	// 80 is the container side here; only a host port is followed by a colon.
	const before = 'services:\n  a:\n    image: x\n    ports:\n      - "8080:80"\n';
	assert.equal(replaceHostPort(before, 80, 9999).replaced, 0);
	// And a same-on-both-sides mapping only changes the host half.
	const same = 'services:\n  a:\n    image: x\n    ports:\n      - "3001:3001"\n';
	const out = replaceHostPort(same, 3001, 3002);
	assert.equal(out.replaced, 1);
	assert.match(out.text, /- "3002:3001"/);
});

test('a bare container-only port is not treated as a host port', () => {
	const before = 'services:\n  a:\n    image: x\n    ports:\n      - "3000"\n';
	assert.equal(replaceHostPort(before, 3000, 3001).replaced, 0);
});

test('ranges are left alone rather than guessed at', () => {
	const before = 'services:\n  a:\n    image: x\n    ports:\n      - "7000-7002:80"\n';
	assert.equal(replaceHostPort(before, 7000, 7100).replaced, 0);
});

test('rejects nonsense port changes', () => {
	const before = 'services:\n  a:\n    ports:\n      - "8080:80"\n';
	assert.equal(replaceHostPort(before, 8080, 8080).replaced, 0);
	assert.equal(replaceHostPort(before, 8080, 0).replaced, 0);
	assert.equal(replaceHostPort(before, 8080, 70000).replaced, 0);
});
