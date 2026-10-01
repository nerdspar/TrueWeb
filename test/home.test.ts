/**
 * The launch-tab preference.
 *
 * The value here comes from a cookie and becomes a redirect target on every
 * launch, so the validation is load-bearing: these tests exist mainly to pin
 * down that nothing off the known list can ever reach `redirect()`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_HOME,
	HOME_TABS,
	homeLabel,
	homePath,
	parseHome
} from '../src/lib/home.ts';

test('each tab round-trips to its own path and label', () => {
	assert.equal(homePath('dashboard'), '/dashboard');
	assert.equal(homePath('storage'), '/storage');
	assert.equal(homePath('datasets'), '/datasets');
	assert.equal(homePath('apps'), '/apps');
	assert.equal(homeLabel('apps'), 'Apps');
	assert.equal(homeLabel('datasets'), 'Datasets');
});

test('a fresh install opens on the dashboard', () => {
	assert.equal(DEFAULT_HOME, 'dashboard');
	assert.equal(parseHome(undefined), 'dashboard');
	assert.equal(parseHome(null), 'dashboard');
	assert.equal(parseHome(''), 'dashboard');
	assert.equal(homePath(undefined), '/dashboard');
	assert.equal(homeLabel(undefined), 'Dashboard');
});

test('a hostile cookie cannot redirect off the app', () => {
	// Everything a hand-edited cookie might try. All must collapse to the
	// default — a relative path at worst, never an absolute or protocol URL.
	for (const hostile of [
		'//evil.example',
		'https://evil.example',
		'http://evil.example',
		'/../../etc/passwd',
		'javascript:alert(1)',
		'/apps?x=1',
		'apps/../../..',
		'/settings',
		'DASHBOARD',
		' apps',
		'apps ',
		'{"value":"apps"}'
	]) {
		assert.equal(parseHome(hostile), DEFAULT_HOME, `parseHome(${hostile})`);
		const path = homePath(hostile);
		assert.equal(path, '/dashboard', `homePath(${hostile})`);
		assert.ok(path.startsWith('/') && !path.startsWith('//'), `relative: ${hostile}`);
	}
});

test('every declared tab resolves, so the list cannot drift from the paths', () => {
	for (const tab of HOME_TABS) {
		assert.equal(parseHome(tab.value), tab.value);
		assert.equal(homePath(tab.value), tab.path);
		assert.equal(homeLabel(tab.value), tab.label);
		// A tab that isn't a real route would 404 the launcher.
		assert.match(tab.path, /^\/[a-z]+$/);
	}
	// Paths must be unique, or two rows would send you to the same screen.
	assert.equal(new Set(HOME_TABS.map((t) => t.path)).size, HOME_TABS.length);
});
