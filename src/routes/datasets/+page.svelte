<script lang="ts">
	/**
	 * Datasets (§5.6) — the tree.
	 *
	 * Pool roots are expanded, everything below starts collapsed: 54 of this
	 * box's 61 datasets sit at one level, and rendering them all at once is a
	 * wall of names rather than a browsable tree.
	 */
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import PathPicker from '$lib/components/PathPicker.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { buildTree, propText, visibleNodes } from '$lib/datasets/props';

	let { data }: { data: PageData } = $props();

	const roots = $derived(buildTree(data.datasets));
	let expanded = $state<Set<string>>(new Set());
	let filter = $state('');
	let toastMsg = $state('');
	let pickerOpen = $state(false);

	/**
	 * With a filter typed, every ancestor of a match is forced open — otherwise
	 * searching for a nested dataset finds nothing you can see.
	 */
	const effectiveExpanded = $derived.by(() => {
		const term = filter.trim().toLowerCase();
		if (!term) return expanded;
		const open = new Set(expanded);
		for (const row of data.datasets) {
			if (!row.name.toLowerCase().includes(term)) continue;
			const parts = row.name.split('/');
			for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/'));
		}
		return open;
	});

	const nodes = $derived.by(() => {
		const term = filter.trim().toLowerCase();
		const all = visibleNodes(roots, effectiveExpanded);
		if (!term) return all;
		// Keep matches and any ancestor of a match, so the path stays readable.
		return all.filter((n) => {
			if (n.row.name.toLowerCase().includes(term)) return true;
			return data.datasets.some(
				(d) => d.name.toLowerCase().includes(term) && d.name.startsWith(`${n.row.name}/`)
			);
		});
	});

	function toggle(name: string) {
		const next = new Set(expanded);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		expanded = next;
	}

	const hasChildren = (name: string) =>
		data.datasets.some((d) => d.name.startsWith(`${name}/`));

	onMount(() => {
		// Pool roots open, the rest closed.
		expanded = new Set(data.datasets.filter((d) => !d.name.includes('/')).map((d) => d.name));
	});
</script>

<svelte:head><title>Datasets · TrueWeb</title></svelte:head>

<header class="head">
	<div class="titlerow">
		<h1>Datasets</h1>
		<button class="add" aria-label="Create a dataset or folder" onclick={() => (pickerOpen = true)}
			>+</button
		>
	</div>
	{#if data.reachable}
		<input
			class="search"
			type="search"
			placeholder="Filter datasets"
			bind:value={filter}
			spellcheck="false"
			autocapitalize="off"
			autocorrect="off"
			aria-label="Filter datasets"
		/>
	{/if}
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else if nodes.length === 0}
	<div class="empty">
		<div class="icon">🔍</div>
		<h2>Nothing matches</h2>
		<p class="dim">No dataset name contains “{filter}”.</p>
	</div>
{:else}
	<ul class="tree">
		{#each nodes as node (node.row.name)}
			<li style={`--depth: ${node.depth}`}>
				<button
					class="twist"
					class:invisible={!hasChildren(node.row.name)}
					aria-label={effectiveExpanded.has(node.row.name)
						? `Collapse ${node.label}`
						: `Expand ${node.label}`}
					aria-expanded={effectiveExpanded.has(node.row.name)}
					onclick={() => toggle(node.row.name)}
				>
					{effectiveExpanded.has(node.row.name) ? '▾' : '▸'}
				</button>
				<a class="row" href={`/datasets/${node.row.name}`}>
					<span class="names">
						<span class="label">{node.label}</span>
						<span class="sub">
							{#if node.row.type !== 'FILESYSTEM'}{node.row.type.toLowerCase()} · {/if}
							{node.row.mountpoint ?? node.row.name}
						</span>
					</span>
					<span class="figures">
						{#if node.row.locked}
							<span class="lock" title="Encrypted and locked">🔒</span>
						{:else if node.row.encrypted}
							<span class="lock open" title="Encrypted and unlocked">🔓</span>
						{/if}
						<span class="used">{propText(node.row.used) || '—'}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
	<p class="count dim">
		{data.datasets.length} datasets{filter.trim() ? ` · ${nodes.length} shown` : ''}
	</p>
{/if}

<PathPicker
	bind:open={pickerOpen}
	title="Create a dataset or folder"
	onpick={(path) => {
		toastMsg = `Created ${path}. Pull to refresh to see it in the tree.`;
	}}
/>
<Toast bind:message={toastMsg} />

<style>
	.head {
		padding: calc(var(--sa-top) + 14px) 16px 10px;
	}
	.titlerow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h1 {
		margin: 0;
		font-size: 26px;
		letter-spacing: -0.02em;
	}
	.add {
		width: 40px;
		min-height: 40px;
		border-radius: 999px;
		border: 0;
		background: var(--accent-grad);
		color: var(--on-accent);
		font-size: 22px;
		line-height: 1;
	}
	.search {
		width: 100%;
		min-height: 44px;
		margin-top: 10px;
		padding: 8px 12px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		font-size: 15px;
	}
	.tree {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
	}
	.tree li {
		display: flex;
		align-items: stretch;
		gap: 2px;
		padding-left: calc(var(--depth) * 16px);
		border-bottom: 1px solid var(--border);
	}
	.twist {
		/* The primary control on this screen, so it gets a real tap target
		   (§8: 44px) rather than a decorative glyph. */
		flex: none;
		width: var(--tap);
		min-height: var(--tap);
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: 17px;
		line-height: 1;
	}
	.twist.invisible {
		visibility: hidden;
	}
	.row {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 12px 16px 12px 0;
		min-width: 0;
		text-decoration: none;
		color: inherit;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.label {
		font-size: 15px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 11px;
		color: var(--text-faint);
		font-family: var(--mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.figures {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.lock {
		font-size: 12px;
	}
	.lock.open {
		opacity: 0.5;
	}
	.used {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
	}
	.count {
		margin: 12px 16px 0;
		font-size: 12px;
	}
	.empty {
		margin: 40px 24px;
		text-align: center;
	}
	.icon {
		font-size: 34px;
		margin-bottom: 8px;
	}
	.empty h2 {
		margin: 0 0 6px;
		font-size: 18px;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
