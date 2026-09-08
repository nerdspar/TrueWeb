<script lang="ts">
	import type { PageData } from './$types';
	import type { AppRecord } from '$lib/server/truenas/methods';
	import StateBadge from '$lib/components/StateBadge.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	let { data }: { data: PageData } = $props();

	type Filter = 'all' | 'running' | 'stopped' | 'updates';
	type Sort = 'state' | 'name';

	let filter = $state<Filter>('all');
	let sort = $state<Sort>('state');

	const hasUpdate = (a: AppRecord) => Boolean(a.upgrade_available || a.image_updates_available);

	// Stopped/erroring first when sorting by state — the rows that want attention.
	const STATE_ORDER: Record<string, number> = {
		CRASHED: 0,
		STOPPED: 1,
		STOPPING: 2,
		DEPLOYING: 3,
		RUNNING: 4
	};

	const filtered = $derived.by(() => {
		let apps = [...data.apps];
		if (filter === 'running') apps = apps.filter((a) => a.state === 'RUNNING');
		else if (filter === 'stopped')
			apps = apps.filter((a) => a.state === 'STOPPED' || a.state === 'CRASHED');
		else if (filter === 'updates') apps = apps.filter(hasUpdate);

		apps.sort((a, b) =>
			sort === 'name'
				? a.name.localeCompare(b.name)
				: (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || a.name.localeCompare(b.name)
		);
		return apps;
	});

	const chips: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'running', label: 'Running' },
		{ key: 'stopped', label: 'Stopped' },
		{ key: 'updates', label: 'Updates' }
	];

	// Apps-service banner (§5.1): only RUNNING is healthy; anything else is worth
	// explaining rather than rendering an empty list.
	const dockerHealthy = $derived(data.docker?.status === 'RUNNING');
</script>

<header class="head">
	<div class="titlerow">
		<h1>Apps</h1>
		{#if data.reachable && data.pendingUpdates > 0}
			<span class="updates" title="Apps with an update available">
				{data.pendingUpdates} update{data.pendingUpdates === 1 ? '' : 's'}
			</span>
		{/if}
	</div>

	{#if data.reachable && data.docker && !dockerHealthy}
		<div class="banner warn" role="status">
			<strong>Apps service: {data.docker.status}</strong>
			<span>{data.docker.description || 'The Apps (Docker) service is not running.'}</span>
		</div>
	{/if}
</header>

{#if !data.reachable}
	<div class="state">
		<div class="state-icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p>{data.reason}</p>
		{#if data.configured}
			<p class="dim">The connection retries automatically — this page will fill in once it's back.</p>
		{/if}
	</div>
{:else}
	<div class="chips" role="tablist" aria-label="Filter apps">
		{#each chips as c (c.key)}
			<button
				class="chip"
				class:on={filter === c.key}
				role="tab"
				aria-selected={filter === c.key}
				onclick={() => (filter = c.key)}
			>
				{c.label}
			</button>
		{/each}
		<button
			class="chip sort"
			onclick={() => (sort = sort === 'state' ? 'name' : 'state')}
			title="Toggle sort"
		>
			Sort: {sort === 'state' ? 'State' : 'Name'}
		</button>
	</div>

	{#if data.apps.length === 0}
		<Skeleton rows={4} />
		<p class="dim center">No apps installed.</p>
	{:else if filtered.length === 0}
		<p class="dim center">No apps match this filter.</p>
	{:else}
		<ul class="list">
			{#each filtered as app (app.id)}
				<li class="row">
					<div class="avatar" aria-hidden="true">{app.name.charAt(0).toUpperCase()}</div>
					<div class="meta">
						<div class="name">
							{app.name}
							{#if hasUpdate(app)}
								<span class="pill" title="Update available">⬆ update</span>
							{/if}
							{#if app.custom_app}
								<span class="pill ghost" title="Custom (compose) app">custom</span>
							{/if}
						</div>
						{#if app.human_version}
							<div class="ver">{app.human_version}</div>
						{/if}
					</div>
					<StateBadge state={app.state} />
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.head {
		position: sticky;
		top: 0;
		z-index: 10;
		padding: calc(var(--sa-top) + 12px) 16px 10px;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
	}
	.titlerow {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.updates {
		font-size: 13px;
		font-weight: 600;
		color: var(--on-accent);
		background: var(--accent-grad);
		padding: 4px 10px;
		border-radius: 999px;
	}
	.banner {
		margin-top: 10px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
	}
	.banner.warn {
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 38%, transparent);
		color: var(--text);
	}

	.chips {
		display: flex;
		gap: 8px;
		padding: 12px 16px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.chips::-webkit-scrollbar {
		display: none;
	}
	.chip {
		flex: none;
		padding: 8px 14px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-size: 13px;
		font-weight: 600;
		min-height: 38px;
	}
	.chip.on {
		color: var(--text);
		border-color: transparent;
		background: color-mix(in srgb, var(--accent) 22%, var(--surface-2));
	}
	.chip.sort {
		margin-left: auto;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		min-height: 64px;
	}
	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		flex: none;
		display: grid;
		place-items: center;
		font-weight: 700;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.meta {
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.ver {
		font-size: 12px;
		color: var(--text-faint);
		margin-top: 2px;
	}
	.pill {
		font-size: 10px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 5px;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.pill.ghost {
		color: var(--text-dim);
		background: var(--surface-3);
	}

	.state {
		text-align: center;
		padding: 64px 24px;
	}
	.state-icon {
		font-size: 36px;
	}
	.state h2 {
		margin: 12px 0 6px;
	}
	.dim {
		color: var(--text-dim);
	}
	.center {
		text-align: center;
		padding: 24px;
	}
</style>
