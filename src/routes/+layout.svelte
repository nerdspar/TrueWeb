<script lang="ts">
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

	// M2 ships the Apps tab only (§11). The other tabs are placeholders so the
	// bottom-nav shape is real, but they are not linked until their milestone.
	const tabs = [
		{ href: '/', label: 'Apps', icon: 'apps', enabled: true },
		{ href: '/dashboard', label: 'Dash', icon: 'dash', enabled: true },
		{ href: '/storage', label: 'Storage', icon: 'storage', enabled: false },
		{ href: '/datasets', label: 'Data', icon: 'data', enabled: false }
	];

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
			{#if tab.enabled}
				<a class="tab" class:active={isActive(tab.href)} href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}>
					<span class="dot" data-icon={tab.icon}></span>
					<span class="label">{tab.label}</span>
				</a>
			{:else}
				<span class="tab disabled" aria-disabled="true" title="Coming later">
					<span class="dot" data-icon={tab.icon}></span>
					<span class="label">{tab.label}</span>
				</span>
			{/if}
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

	.tab.disabled {
		opacity: 0.4;
	}

	.dot {
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: var(--surface-3);
	}

	.tab.active .dot {
		background: var(--accent-grad);
	}
</style>
