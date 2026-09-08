import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	assertAllowed,
	isAllowed,
	isJobMethod,
	MethodNotAllowedError,
	ALLOWLIST
} from '../src/lib/server/truenas/allowlist.ts';

test('allowed read method passes and returns its spec', () => {
	const spec = assertAllowed('app.query');
	assert.equal(spec.tier, 'read');
	assert.equal(isAllowed('app.query'), true);
});

test('unlisted method is refused before the socket', () => {
	assert.throws(() => assertAllowed('app.definitely_not_real'), (err: unknown) => {
		assert.ok(err instanceof MethodNotAllowedError);
		assert.match(err.message, /not on the allowlist/);
		return true;
	});
	assert.equal(isAllowed('app.definitely_not_real'), false);
});

test('a §6 never-expose method is refused with the destructive reason', () => {
	for (const method of ['pool.create', 'disk.wipe', 'system.reboot', 'update.run', 'config.reset']) {
		assert.throws(() => assertAllowed(method), (err: unknown) => {
			assert.ok(err instanceof MethodNotAllowedError);
			assert.match(err.message, /never exposed/);
			return true;
		}, `${method} should be denied`);
	}
});

test('job methods are flagged; reads are not', () => {
	assert.equal(isJobMethod('app.start'), true);
	assert.equal(isJobMethod('app.stop'), true);
	assert.equal(isJobMethod('app.redeploy'), true);
	assert.equal(isJobMethod('app.query'), false);
	assert.equal(isJobMethod('auth.me'), false);
});

test('every M1 method the client calls is on the allowlist and verified', () => {
	const m1 = [
		'auth.login_ex',
		'auth.me',
		'core.subscribe',
		'core.unsubscribe',
		'core.get_jobs',
		'app.query',
		'app.start',
		'app.stop',
		'app.redeploy'
	];
	for (const method of m1) {
		assert.ok(ALLOWLIST[method], `${method} must be on the allowlist`);
		assert.equal(ALLOWLIST[method]?.verified, true, `${method} must be marked verified`);
	}
});
