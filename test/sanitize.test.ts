import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCompose } from '../src/lib/compose/sanitize.ts';

test('straightens the curly quotes iOS and GitHub produce', () => {
	const r = sanitizeCompose('services:\n  web:\n    image: “nginx:latest”\n    x: ‘y’\n');
	assert.ok(r.text.includes('"nginx:latest"'));
	assert.ok(r.text.includes("'y'"));
	assert.match(r.changes.join(' '), /4 curly quotes/);
});

test('replaces tabs with two spaces (YAML forbids tab indentation)', () => {
	const r = sanitizeCompose('services:\n\tweb:\n\t\timage: nginx\n');
	assert.ok(!r.text.includes('\t'));
	assert.ok(r.text.includes('\n  web:'));
	assert.ok(r.text.includes('\n    image: nginx'));
	assert.match(r.changes.join(' '), /3 tabs/);
});

test('normalises CRLF line endings', () => {
	const r = sanitizeCompose('services:\r\n  web:\r\n    image: nginx\r\n');
	assert.ok(!r.text.includes('\r'));
	assert.match(r.changes.join(' '), /line ending/);
});

test('replaces non-breaking spaces', () => {
	// U+00A0 between key and value — renders identically, breaks the parse.
	const r = sanitizeCompose('services:\n  web:\n    image: nginx\n');
	assert.ok(!r.text.includes(' '));
	assert.match(r.changes.join(' '), /non-breaking space/);
});

test('removes zero-width characters', () => {
	const r = sanitizeCompose('services:​\n  web:\n    image: nginx\n');
	assert.ok(!/[​-‍﻿]/.test(r.text));
	assert.match(r.changes.join(' '), /invisible character/);
});

test('strips Markdown code fences from a pasted README block', () => {
	const r = sanitizeCompose('```yaml\nservices:\n  web:\n    image: nginx\n```\n');
	assert.ok(r.text.startsWith('services:'));
	assert.ok(!r.text.includes('```'));
	assert.match(r.changes.join(' '), /2 Markdown code fences/);
});

test('trims surrounding blank lines', () => {
	const r = sanitizeCompose('\n\n\nservices:\n  web:\n    image: nginx\n\n\n');
	assert.ok(r.text.startsWith('services:'));
	assert.equal(r.text.endsWith('image: nginx\n'), true);
	assert.match(r.changes.join(' '), /Trimmed blank lines/);
});

test('clean input is left alone and reports no changes', () => {
	const clean = 'services:\n  web:\n    image: nginx\n';
	const r = sanitizeCompose(clean);
	assert.equal(r.text, clean);
	assert.deepEqual(r.changes, []);
});

test('handles the full mobile-paste disaster in one pass', () => {
	const damaged = '```yaml\r\n\r\nservices:\r\n\tweb:\r\n\t\timage: “nginx”\r\n```\r\n';
	const r = sanitizeCompose(damaged);
	assert.equal(r.text, 'services:\n  web:\n    image: "nginx"\n');
	// Every category should have been reported to the user.
	const notes = r.changes.join(' | ');
	for (const expected of ['line ending', 'non-breaking space', 'curly quote', 'tab', 'fence']) {
		assert.match(notes, new RegExp(expected), `expected a note about ${expected}: ${notes}`);
	}
});
