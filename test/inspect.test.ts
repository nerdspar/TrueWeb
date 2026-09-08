import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	inspectCompose,
	validateAppName,
	findPlaceholders,
	substitutePlaceholders
} from '../src/lib/compose/inspect.ts';

const COMPOSE = `services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
      - "127.0.0.1:9443:443"
      - "3000"
      - 5000
    volumes:
      - /mnt/NAS/Data/web:/usr/share/nginx/html:ro
      - named-volume:/cache
      - ./relative:/rel
    environment:
      PUID: 1001
      PGID: 1002
  api:
    image: ghcr.io/example/api
    ports:
      - target: 8000
        published: 18000
        protocol: tcp
    volumes:
      - type: bind
        source: /mnt/NAS/Data/api
        target: /data
`;

test('app name validation follows the documented pattern', () => {
	assert.equal(validateAppName('jellyfin'), null);
	assert.equal(validateAppName('my-app-1'), null);
	assert.ok(validateAppName(''));
	assert.ok(validateAppName('-leading'));
	assert.ok(validateAppName('trailing-'));
	assert.ok(validateAppName('Caps'));
	assert.ok(validateAppName('under_score'));
	assert.ok(validateAppName('9lives'));
	assert.ok(validateAppName('a'.repeat(41)));
});

test('rejects a compose file with no top-level services key', () => {
	const r = inspectCompose('include:\n  - other.yaml\n');
	assert.equal(r.ok, false);
	assert.match(r.error?.message ?? '', /services/);
	assert.match(r.error?.message ?? '', /include/);
});

test('reports a YAML parse error with its line', () => {
	const r = inspectCompose('services:\n  web:\n   image: nginx\n  - bad\n');
	assert.equal(r.ok, false);
	assert.ok(r.error);
	assert.equal(typeof r.error?.line, 'number');
});

test('rejects empty and non-mapping input', () => {
	assert.equal(inspectCompose('').ok, false);
	assert.equal(inspectCompose('- a\n- b\n').ok, false);
	assert.equal(inspectCompose('services:\n').ok, false);
});

test('extracts published host ports across every compose port syntax', () => {
	const r = inspectCompose(COMPOSE);
	assert.equal(r.ok, true);
	// 8080 (host:container), 9443 (ip:host:container), 18000 (long syntax).
	// "3000" and 5000 are container-only short forms — no fixed host port.
	assert.deepEqual(r.hostPorts, [8080, 9443, 18000]);
});

test('extracts only /mnt bind-mount sources, not named or relative volumes', () => {
	const r = inspectCompose(COMPOSE);
	assert.deepEqual(r.hostPaths, ['/mnt/NAS/Data/api', '/mnt/NAS/Data/web']);
});

test('picks up PUID/PGID for the chown prefill', () => {
	const r = inspectCompose(COMPOSE);
	assert.equal(r.puid, 1001);
	assert.equal(r.pgid, 1002);
});

test('reads PUID/PGID from the list form of environment too', () => {
	const r = inspectCompose(
		'services:\n  a:\n    image: x\n    environment:\n      - PUID=568\n      - PGID=568\n'
	);
	assert.equal(r.puid, 568);
	assert.equal(r.pgid, 568);
});

test('port ranges expand, absurd ranges are ignored', () => {
	const ok = inspectCompose('services:\n  a:\n    image: x\n    ports:\n      - "7000-7002:80"\n');
	assert.deepEqual(ok.hostPorts, [7000, 7001, 7002]);
	const silly = inspectCompose('services:\n  a:\n    image: x\n    ports:\n      - "1-9999:80"\n');
	assert.deepEqual(silly.hostPorts, []);
});

test('strips the protocol suffix from a port spec', () => {
	const r = inspectCompose('services:\n  a:\n    image: x\n    ports:\n      - "5353:53/udp"\n');
	assert.deepEqual(r.hostPorts, [5353]);
});

test('finds ${VAR} placeholders and knows which have defaults', () => {
	const found = findPlaceholders(
		'image: ${IMAGE}\ntag: ${TAG:-latest}\nreq: ${MUST:?set me}\nbare: $HOME\nliteral: $$NOPE\n'
	);
	const byName = Object.fromEntries(found.map((p) => [p.name, p.hasDefault]));
	assert.equal(byName.IMAGE, false);
	assert.equal(byName.TAG, true);
	assert.equal(byName.MUST, false);
	assert.equal(byName.HOME, false);
	assert.equal('NOPE' in byName, false, '$$ is an escaped dollar, not a reference');
});

test('substitutes provided values, falls back to defaults, leaves unknowns visible', () => {
	const out = substitutePlaceholders(
		'a: ${A}\nb: ${B:-fallback}\nc: ${C}\nd: $$LITERAL\n',
		{ A: 'given', B: 'override' }
	);
	assert.match(out, /a: given/);
	assert.match(out, /b: override/);
	assert.match(out, /c: \$\{C\}/, 'unresolved placeholders stay visible');
	assert.match(out, /d: \$\$LITERAL/);
});

test('an empty provided value still falls back to the inline default', () => {
	const out = substitutePlaceholders('t: ${TAG:-latest}\n', { TAG: '' });
	assert.match(out, /t: latest/);
});

test('substitution output re-parses and yields the substituted values', () => {
	const text = substitutePlaceholders(
		'services:\n  a:\n    image: nginx:${TAG:-latest}\n    ports:\n      - "${PORT}:80"\n',
		{ PORT: '8081' }
	);
	const r = inspectCompose(text);
	assert.equal(r.ok, true);
	assert.deepEqual(r.hostPorts, [8081]);
	assert.match(text, /nginx:latest/);
});

test('flags relative bind mounts, which are meaningless on TrueNAS', () => {
	const r = inspectCompose(
		'services:\n  a:\n    image: x\n    volumes:\n      - ./data:/app/data\n      - ../up:/x\n'
	);
	assert.equal(r.ok, true);
	assert.deepEqual(
		r.suspectPaths.map((s) => s.why),
		['relative', 'relative']
	);
	assert.deepEqual(r.hostPaths, [], 'relative paths are not provisionable');
});

test('flags absolute paths outside /mnt, which land on the boot pool', () => {
	const r = inspectCompose('services:\n  a:\n    image: x\n    volumes:\n      - /opt/data:/d\n');
	assert.deepEqual(r.suspectPaths, [{ source: '/opt/data', why: 'outside-mnt' }]);
});

test('named volumes are not flagged — they are legitimate', () => {
	const r = inspectCompose(
		'services:\n  a:\n    image: x\n    volumes:\n      - dbdata:/var/lib/db\nvolumes:\n  dbdata:\n'
	);
	assert.deepEqual(r.suspectPaths, []);
	assert.deepEqual(r.hostPaths, []);
});
