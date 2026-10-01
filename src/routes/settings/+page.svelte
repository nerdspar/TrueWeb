<script lang="ts">
	/**
	 * Settings (§5). One group for now; the shape follows the house
	 * SettingsGroup/SettingsRow pattern so a second group drops in beside it.
	 */
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import { HOME_TABS, type HomeTab } from '$lib/home';

	let { data }: { data: PageData } = $props();

	/**
	 * Optimistic: the tick moves on tap rather than after the round trip. The
	 * request only writes a cookie, and a row that waits ~100ms to respond feels
	 * broken on a phone.
	 *
	 * `pending` is an override on top of the server's value rather than a copy of
	 * it — a copy would ignore the reload that follows the save, and would snap
	 * back to whatever was true when the page first rendered.
	 */
	let pending = $state<HomeTab | null>(null);
	const home = $derived(pending ?? data.home);
	let saving = $state(false);
</script>

<svelte:head><title>Settings · TrueWeb</title></svelte:head>

<header class="head">
	<!-- A real link to the parent screen, not history.back(): the gear that opens
	     this lives on the dashboard, and `/` would land on whatever default tab
	     you just chose. -->
	<a class="back" href="/dashboard" aria-label="Back to dashboard">←</a>
	<h1>Settings</h1>
</header>

<h2 class="grouplabel" id="home-label">Opens on</h2>
<form
	method="POST"
	action="?/home"
	class="group"
	aria-labelledby="home-label"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			// Reload first, then drop the override — clearing it early would show
			// the old value for a frame. A failed write reloads the unchanged
			// cookie, so the tick lands back where it was with no special case.
			await update({ reset: false });
			pending = null;
			saving = false;
		};
	}}
>
	{#each HOME_TABS as tab, i (tab.value)}
		<button
			class="row"
			class:last={i === HOME_TABS.length - 1}
			name="home"
			value={tab.value}
			aria-pressed={home === tab.value}
			onclick={() => (pending = tab.value)}
		>
			<span class="label">{tab.label}</span>
			{#if home === tab.value}<span class="tick" aria-hidden="true">✓</span>{/if}
		</button>
	{/each}
</form>
<p class="hint" aria-live="polite">
	{saving ? 'Saving…' : 'The tab TrueWeb opens on when you launch it from your Home Screen.'}
</p>

<style>
	/*
	 * Matches the sub-page header the app/dataset screens already use: sticky,
	 * translucent, a 40px square back button. TrueWeb pads pages with a literal
	 * 16px rather than a --gutter token, and names its safe-area insets --sa-*,
	 * so this follows the app rather than the playbook's canonical token names.
	 */
	.head {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(var(--sa-top) + 12px) 16px 12px;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
	}
	.back {
		flex: none;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--surface-2);
		color: var(--text);
		font-size: 20px;
		text-decoration: none;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.grouplabel {
		margin: 18px 16px 8px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.group {
		display: flex;
		flex-direction: column;
		margin: 0 16px;
		border-radius: var(--r);
		background: var(--surface);
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-height: var(--tap);
		padding: 12px 14px;
		border: 0;
		border-bottom: 1px solid var(--border);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 16px;
		text-align: left;
	}
	/* No divider under the last row — the group's own edge ends the list. */
	.row.last {
		border-bottom: 0;
	}
	.tick {
		color: var(--accent);
		font-weight: 700;
	}
	.hint {
		margin: 10px 16px 0;
		font-size: 12px;
		color: var(--text-faint);
	}
</style>
