import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertIso, alertMessage, alertTone, sortAlerts } from '../src/lib/dashboard/alerts.ts';

test('the substituted message wins over the raw template', () => {
	// Straight off the box: `text` still has printf placeholders in it.
	const alert = {
		text: 'Updates are available for %(count)d application%(plural)s: %(apps)s',
		formatted: 'Updates are available for 18 applications: seek, jellyfin'
	};
	assert.equal(alertMessage(alert), 'Updates are available for 18 applications: seek, jellyfin');
});

test('text is used when there is no formatted message', () => {
	assert.equal(alertMessage({ text: 'A system update is available.', formatted: null }), 'A system update is available.');
	assert.equal(alertMessage({ text: null, formatted: '   ' }), '');
	assert.equal(alertMessage({}), '');
});

test('markup in an alert is stripped, never rendered', () => {
	assert.equal(
		alertMessage({ formatted: 'Pool <b>NAS</b> is <i>DEGRADED</i>' }),
		'Pool NAS is DEGRADED'
	);
	assert.equal(alertMessage({ formatted: 'line one<br>line two' }), 'line one line two');
	// The reason tags are stripped rather than trusted.
	assert.equal(
		alertMessage({ formatted: '<script>alert(1)</script>ok' }),
		'alert(1)ok'
	);
});

test('the epoch-object date shape is understood', () => {
	// The middleware sends {"$date": ms}, not an ISO string.
	assert.equal(alertIso({ $date: 1788897546000 }), new Date(1788897546000).toISOString());
	assert.equal(alertIso('2026-09-08T12:00:00.000Z'), '2026-09-08T12:00:00.000Z');
	assert.equal(alertIso(null), '');
	assert.equal(alertIso('nonsense'), '');
	assert.equal(alertIso({ $date: Number.NaN }), '');
});

test('an unknown level is treated as a warning, not ignored', () => {
	assert.equal(alertTone('INFO'), 'info');
	assert.equal(alertTone('WARNING'), 'warn');
	assert.equal(alertTone('CRITICAL'), 'danger');
	assert.equal(alertTone('error'), 'danger');
	// Docs call level a free string, so the default must not be the quiet one.
	assert.equal(alertTone('SOMETHING_NEW'), 'warn');
	assert.equal(alertTone(undefined), 'warn');
});

test('alerts sort worst-first, then newest', () => {
	const sorted = sortAlerts([
		{ level: 'INFO', datetime: { $date: 3000 } },
		{ level: 'ERROR', datetime: { $date: 1000 } },
		{ level: 'WARNING', datetime: { $date: 2000 } },
		{ level: 'INFO', datetime: { $date: 5000 } }
	]);
	assert.deepEqual(
		sorted.map((a) => [a.level, (a.datetime as { $date: number }).$date]),
		[
			['ERROR', 1000],
			['WARNING', 2000],
			['INFO', 5000],
			['INFO', 3000]
		]
	);
});
