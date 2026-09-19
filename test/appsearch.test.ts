/**
 * Searching the apps list by name.
 *
 * The names here are real ones from the box this app manages — hyphenated,
 * mixed-case, and long — because those are the cases the matching has to get
 * right to be worth having.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAppQuery, normalizeAppQuery } from '../src/lib/client/actions.ts';

test('an empty search matches everything, so the list is never hidden', () => {
	assert.equal(matchesAppQuery('jellyfin', ''), true);
	// Whitespace alone is still an empty search, not a term that matches nothing.
	assert.equal(matchesAppQuery('jellyfin', '   '), true);
});

test('matching is case-insensitive and works on a fragment', () => {
	assert.equal(matchesAppQuery('Jellyfin', 'JELLY'), true);
	assert.equal(matchesAppQuery('jellyfin', 'fin'), true);
	assert.equal(matchesAppQuery('jellyfin', 'jellyfish'), false);
});

test('a typed space finds a hyphenated name', () => {
	// The reason this helper exists: nobody types the hyphen.
	assert.equal(matchesAppQuery('uptime-kuma', 'uptime kuma'), true);
	assert.equal(matchesAppQuery('uptime-kuma', 'uptimekuma'), true);
	assert.equal(matchesAppQuery('uptime-kuma', 'uptime-kuma'), true);
	assert.equal(matchesAppQuery('uptime-kuma', 'kuma'), true);
});

test('underscores and dots fold away too', () => {
	assert.equal(matchesAppQuery('home_assistant', 'home assistant'), true);
	assert.equal(matchesAppQuery('node.red', 'node red'), true);
	assert.equal(matchesAppQuery('node-red', 'node.red'), true);
});

test('a stray trailing space does not break a match mid-type', () => {
	assert.equal(matchesAppQuery('jellyfin', 'jelly '), true);
	assert.equal(matchesAppQuery('jellyfin', ' jelly'), true);
});

test('a name that is nothing like the term does not match', () => {
	assert.equal(matchesAppQuery('jellyfin', 'plex'), false);
	assert.equal(matchesAppQuery('uptime-kuma', 'grafana'), false);
});

test('normalising keeps letters and digits', () => {
	assert.equal(normalizeAppQuery('Uptime-Kuma'), 'uptimekuma');
	assert.equal(normalizeAppQuery('  Node.RED  '), 'node red'.replace(' ', ''));
	assert.equal(normalizeAppQuery('pi-hole2'), 'pihole2');
});

test('filtering a real list narrows it the way the page will', () => {
	const names = [
		'blueprint',
		'jellyfin',
		'uptime-kuma',
		'home-assistant',
		'pi-hole',
		'qbittorrent'
	];
	const find = (q: string) => names.filter((n) => matchesAppQuery(n, q));
	assert.deepEqual(find('home assistant'), ['home-assistant']);
	// "ho" spans a hyphen in pi-hole, which is the point of normalising.
	assert.deepEqual(find('ho'), ['home-assistant', 'pi-hole']);
	assert.deepEqual(find('t'), ['blueprint', 'uptime-kuma', 'home-assistant', 'qbittorrent']);
	assert.deepEqual(find(''), names);
	assert.deepEqual(find('zzz'), []);
});
