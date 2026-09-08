<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	let { children } = $props();

	let online = $state(true);

	onMount(() => {
		online = navigator.onLine;
		const goOnline = () => (online = true);
		const goOffline = () => (online = false);
		addEventListener('online', goOnline);
		addEventListener('offline', goOffline);

		// Production only (svelte.config.js disables auto-registration) so a
		// cached worker can't shadow assets during development.
		if (import.meta.env.PROD && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js', { type: 'classic' }).catch(() => {
				/* a failed registration must never break the app */
			});
		}

		return () => {
			removeEventListener('online', goOnline);
			removeEventListener('offline', goOffline);
		};
	});

	// All four tabs ship as of M5. Apps sits last despite being the app's reason
	// for existing and still owning `/` — that's the requested order.
	const tabs = [
		{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/storage', label: 'Storage', icon: 'storage' },
		{ href: '/datasets', label: 'Datasets', icon: 'datasets' },
		{ href: '/', label: 'Apps', icon: 'apps' }
	] as const;

	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<div class="app">
	{#if !online}
		<div class="offline" role="status">
			Offline — showing the last known state
		</div>
	{/if}

	<main>
		{@render children()}
	</main>

	<nav class="tabbar" aria-label="Sections">
		{#each tabs as tab (tab.href)}
			<a
				class="tab"
				class:active={isActive(tab.href)}
				href={tab.href}
				aria-current={isActive(tab.href) ? 'page' : undefined}
			>
				<Icon name={tab.icon} />
				<span class="label">{tab.label}</span>
			</a>
		{/each}
	</nav>
</div>

<style>
	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	main {
		flex: 1;
		/* Clear the fixed bottom nav + home indicator. */
		padding-bottom: calc(var(--nav-h) + var(--sa-bottom) + 8px);
	}

	.offline {
		padding: calc(var(--sa-top) + 8px) 16px 8px;
		background: color-mix(in srgb, var(--warn) 18%, var(--surface));
		border-bottom: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		text-align: center;
	}

	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 20;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		height: calc(var(--nav-h) + var(--sa-bottom));
		padding-bottom: var(--sa-bottom);
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
	}

	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		color: var(--text-faint);
		font-size: 11px;
		text-decoration: none;
		min-height: 0;
	}

	.tab.active {
		color: var(--text);
	}

	.tab.active {
		/* The icon inherits currentColor, so the accent needs no second asset. */
		color: var(--accent);
	}

	.label {
		/* Four full words on a 375px screen: let the longest one shrink rather
		   than wrap or clip. */
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
