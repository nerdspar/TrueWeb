/**
 * Paste sanitisation (§5.2) — the make-or-break detail.
 *
 * A compose file pasted from mobile Safari or a rendered GitHub README arrives
 * damaged in predictable ways, and TrueNAS will reject the YAML for reasons
 * that are invisible on a phone screen. This runs before validation and
 * reports what it changed, so the fixes are visible rather than magic.
 *
 * Pure and dependency-free on purpose: it is the most heavily unit-tested piece
 * of the flow.
 */

export interface SanitizeResult {
	text: string;
	/** Human-readable notes describing each fix applied, for display. */
	changes: string[];
}

const SMART_DOUBLE = /[“”„‟″]/g;
const SMART_SINGLE = /[‘’‚‛′]/g;
/** NBSP, narrow NBSP, figure space — all render as a space but aren't one. */
const ODD_SPACES = /[   ]/g;
/** Zero-width characters: invisible, and they break YAML parsing outright. */
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;
/** A Markdown fence line, e.g. ``` or ```yaml — picked up from a README. */
const FENCE = /^\s*```[\w-]*\s*$/;

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

export function sanitizeCompose(input: string): SanitizeResult {
	const changes: string[] = [];
	let text = input;

	// 1. Line endings first, so every later rule sees uniform lines.
	const crlf = (text.match(/\r\n/g) ?? []).length;
	const strayCr = (text.replace(/\r\n/g, '').match(/\r/g) ?? []).length;
	if (crlf || strayCr) {
		text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		changes.push(`Converted ${plural(crlf + strayCr, 'Windows line ending')} to Unix`);
	}

	// 2. Invisible characters. Removed rather than replaced — they are never
	//    meant to be there and a space could change the parse.
	const zeroWidth = (text.match(ZERO_WIDTH) ?? []).length;
	if (zeroWidth) {
		text = text.replace(ZERO_WIDTH, '');
		changes.push(`Removed ${plural(zeroWidth, 'invisible character')}`);
	}

	const oddSpaces = (text.match(ODD_SPACES) ?? []).length;
	if (oddSpaces) {
		text = text.replace(ODD_SPACES, ' ');
		changes.push(`Replaced ${plural(oddSpaces, 'non-breaking space')} with a normal space`);
	}

	// 3. Smart quotes — GitHub's rendered view and iOS both produce these, and
	//    TrueNAS rejects the YAML.
	const dbl = (text.match(SMART_DOUBLE) ?? []).length;
	const sgl = (text.match(SMART_SINGLE) ?? []).length;
	if (dbl) text = text.replace(SMART_DOUBLE, '"');
	if (sgl) text = text.replace(SMART_SINGLE, "'");
	if (dbl + sgl) changes.push(`Straightened ${plural(dbl + sgl, 'curly quote')}`);

	// 4. Tabs. YAML forbids them for indentation.
	const tabs = (text.match(/\t/g) ?? []).length;
	if (tabs) {
		text = text.replace(/\t/g, '  ');
		changes.push(`Replaced ${plural(tabs, 'tab')} with two spaces`);
	}

	// 5. Markdown code fences, from pasting a rendered README.
	// Split without the trailing newline (one is re-added at the end): the empty
	// element it otherwise creates hides a closing fence from the check below and
	// looks like a stray blank line.
	let lines = text.replace(/\n$/, '').split('\n');
	let fences = 0;
	while (lines.length && FENCE.test(lines[0] ?? '')) {
		lines.shift();
		fences++;
	}
	while (lines.length && FENCE.test(lines[lines.length - 1] ?? '')) {
		lines.pop();
		fences++;
	}
	if (fences) changes.push(`Removed ${plural(fences, 'Markdown code fence')}`);

	// 6. Leading/trailing blank lines.
	const before = lines.length;
	while (lines.length && (lines[0] ?? '').trim() === '') lines.shift();
	while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
	if (lines.length !== before) changes.push('Trimmed blank lines');

	// Trailing newline: harmless, and nicer to edit against.
	text = lines.join('\n');
	if (text) text += '\n';

	return { text, changes };
}
