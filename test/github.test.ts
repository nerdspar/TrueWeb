import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveComposeUrl, extractComposeFromMarkdown } from '../src/lib/compose/github.ts';

test('a bare repo URL probes the usual compose names on main then master', () => {
	const r = resolveComposeUrl('https://github.com/amnya/truenas-app-icon-manager');
	assert.equal(r.kind, 'repo');
	assert.equal(r.candidates[0],
		'https://raw.githubusercontent.com/amnya/truenas-app-icon-manager/main/docker-compose.yml');
	// main is exhausted before master is tried.
	assert.equal(r.candidates.slice(0, 4).every((c) => c.includes('/main/')), true);
	assert.equal(r.candidates.slice(4, 8).every((c) => c.includes('/master/')), true);
	// Then a few common folders, and a README to mine as a last resort.
	assert.ok(r.candidates.some((c) => c.includes('/examples/docker-compose.yml')));
	assert.ok(r.readmes.some((c) => c.endsWith('/main/README.md')));
});

test('a blob URL maps straight to that one raw file', () => {
	const r = resolveComposeUrl('https://github.com/o/r/blob/main/deploy/docker-compose.yml');
	assert.equal(r.kind, 'file');
	assert.deepEqual(r.candidates, [
		'https://raw.githubusercontent.com/o/r/main/deploy/docker-compose.yml'
	]);
});

test('the /raw/ form behaves like /blob/', () => {
	const r = resolveComposeUrl('https://github.com/o/r/raw/v2.1/compose.yaml');
	assert.deepEqual(r.candidates, ['https://raw.githubusercontent.com/o/r/v2.1/compose.yaml']);
});

test('a tree URL looks for a compose file in that directory', () => {
	const r = resolveComposeUrl('https://github.com/o/r/tree/main/examples/basic');
	assert.equal(r.kind, 'directory');
	assert.equal(r.candidates.length, 4);
	assert.equal(
		r.candidates[0],
		'https://raw.githubusercontent.com/o/r/main/examples/basic/docker-compose.yml'
	);
});

test('a tree URL with no subdirectory probes the repo root of that branch', () => {
	const r = resolveComposeUrl('https://github.com/o/r/tree/develop');
	assert.equal(
		r.candidates[0],
		'https://raw.githubusercontent.com/o/r/develop/docker-compose.yml'
	);
});

test('a .git suffix and www are tolerated', () => {
	const r = resolveComposeUrl('https://www.github.com/o/r.git');
	assert.equal(r.kind, 'repo');
	assert.equal(r.candidates[0], 'https://raw.githubusercontent.com/o/r/main/docker-compose.yml');
});

test('an existing raw URL is passed straight through', () => {
	const raw = 'https://raw.githubusercontent.com/o/r/main/docker-compose.yml';
	const r = resolveComposeUrl(raw);
	assert.equal(r.kind, 'raw');
	assert.deepEqual(r.candidates, [raw]);
	const gist = resolveComposeUrl('https://gist.githubusercontent.com/o/abc/raw/x.yml');
	assert.equal(gist.kind, 'raw');
});

test('other hosts and nonsense stay unsupported', () => {
	for (const bad of [
		'https://example.com/docker-compose.yml',
		'https://gitlab.com/o/r',
		'https://github.com/onlyowner',
		'not a url',
		''
	]) {
		const r = resolveComposeUrl(bad);
		assert.equal(r.kind, 'unsupported', `${bad} should be unsupported`);
		assert.deepEqual(r.candidates, []);
		assert.deepEqual(r.readmes, []);
	}
});

test('every candidate targets the raw host, never github.com', () => {
	const inputs = [
		'https://github.com/o/r',
		'https://github.com/o/r/tree/main/sub',
		'https://github.com/o/r/blob/main/docker-compose.yml'
	];
	for (const input of inputs) {
		const r = resolveComposeUrl(input);
		for (const c of [...r.candidates, ...r.readmes]) {
			assert.equal(new URL(c).hostname, 'raw.githubusercontent.com', c);
			assert.equal(new URL(c).protocol, 'https:', c);
		}
	}
});

test('mines a compose block out of README markdown', () => {
	const md = [
		'# Project',
		'Install it with Docker:',
		'```bash',
		'docker run -d thing',
		'```',
		'Or compose:',
		'```yaml',
		'services:',
		'  app:',
		'    image: ghcr.io/o/r:latest',
		'    ports:',
		'      - "8099:8080"',
		'```',
		'Done.'
	].join('\n');
	const block = extractComposeFromMarkdown(md);
	assert.ok(block, 'expected a compose block');
	assert.match(block ?? '', /^services:/m);
	assert.match(block ?? '', /8099:8080/);
	// The bash block must not be mistaken for the stack.
	assert.doesNotMatch(block ?? '', /docker run/);
});

test('an untagged fence still counts if it declares services', () => {
	const md = '```\nservices:\n  a:\n    image: x\n```\n';
	assert.match(extractComposeFromMarkdown(md) ?? '', /^services:/m);
});

test('markdown with no compose block yields null', () => {
	const md = '# Title\n```bash\nnpm install\n```\nNo stack here.\n';
	assert.equal(extractComposeFromMarkdown(md), null);
});
