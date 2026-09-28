/**
 * Mapping compose networks back to the apps that own them.
 *
 * The network names here are real ones from the box: `docker.network.query`
 * lowercases its keys (`name`, `created`) where the same objects nested inside
 * app.query keep Docker's capitalised spelling, which is the sort of thing that
 * silently yields an empty map if you guess.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployTimes, type DockerNetwork } from '../src/lib/server/truenas/methods.ts';

/** A stand-in client: only the one call matters here. */
function clientReturning(networks: unknown) {
	return { call: async () => networks } as never;
}

const iso = (s: string) => new Date(s).getTime();

test('an app network maps to its app, newest wins', async () => {
	const nets: DockerNetwork[] = [
		{ name: 'ix-trueweb_default', created: '2026-09-28T16:08:00Z' },
		{ name: 'ix-jellyfin_default', created: '2026-09-18T15:45:00Z' },
		{ name: 'ix-adguard-sync_default', created: '2026-09-15T13:54:00Z' },
		// A project with two networks: the later one is when it last came up.
		{ name: 'ix-blueprint_blueprint', created: '2026-09-15T19:06:00Z' },
		{ name: 'ix-blueprint_default', created: '2026-09-10T09:00:00Z' }
	];
	const map = await deployTimes(clientReturning(nets));
	assert.equal(map.get('trueweb'), iso('2026-09-28T16:08:00Z'));
	assert.equal(map.get('jellyfin'), iso('2026-09-18T15:45:00Z'));
	// Hyphenated app names must survive: only the trailing _suffix is the network.
	assert.equal(map.get('adguard-sync'), iso('2026-09-15T13:54:00Z'));
	assert.equal(map.get('blueprint'), iso('2026-09-15T19:06:00Z'));
});

test("docker's own networks are not mistaken for apps", async () => {
	const map = await deployTimes(
		clientReturning([
			{ name: 'bridge', created: '2026-09-15T13:49:00Z' },
			{ name: 'host', created: '2024-11-06T12:21:00Z' },
			{ name: 'none', created: '2024-11-06T12:21:00Z' },
			{ name: 'lan_macvlan', created: '2026-02-12T19:59:00Z' }
		])
	);
	assert.equal(map.size, 0);
});

test('a stopped app simply has no entry, never a zero', async () => {
	const map = await deployTimes(
		clientReturning([{ name: 'ix-jellyfin_default', created: '2026-09-18T15:45:00Z' }])
	);
	// bumper is stopped, so its network is gone. The caller must be able to tell
	// "no deploy time" from "deployed at the epoch".
	assert.equal(map.has('bumper'), false);
	assert.equal(map.get('bumper'), undefined);
});

test('malformed entries are skipped rather than poisoning the map', async () => {
	const map = await deployTimes(
		clientReturning([
			{ name: 'ix-good_default', created: '2026-09-18T15:45:00Z' },
			{ name: 'ix-nodate_default' },
			{ name: 'ix-baddate_default', created: 'not a date' },
			{ created: '2026-09-18T15:45:00Z' },
			{}
		])
	);
	assert.deepEqual([...map.keys()], ['good']);
});

test('sorting by deploy time puts recent work first and stopped apps last', async () => {
	const deployed = Object.fromEntries(
		await deployTimes(
			clientReturning([
				{ name: 'ix-trueweb_default', created: '2026-09-28T16:08:00Z' },
				{ name: 'ix-aftertaste_default', created: '2026-09-27T23:03:00Z' },
				{ name: 'ix-sabnzbd_default', created: '2026-09-22T18:15:00Z' }
			])
		)
	);
	const apps = [
		{ name: 'sabnzbd' },
		{ name: 'bumper' }, // stopped, no network
		{ name: 'trueweb' },
		{ name: 'aftertaste' },
		{ name: 'mylar' } // stopped, no network
	];
	const sorted = [...apps].sort(
		(a, b) =>
			(deployed[b.name] ?? 0) - (deployed[a.name] ?? 0) || a.name.localeCompare(b.name)
	);
	assert.deepEqual(
		sorted.map((a) => a.name),
		// The two undated apps tie at 0 and fall back to alphabetical.
		['trueweb', 'aftertaste', 'sabnzbd', 'bumper', 'mylar']
	);
});
