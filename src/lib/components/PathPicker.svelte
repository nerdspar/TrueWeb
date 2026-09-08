<script lang="ts">
	/**
	 * Browse the storage tree and pick a location, creating a dataset or folder
	 * on the spot (§5.6's minimal creation component, reused by the compose
	 * pre-flight per §5.2). Full-height sheet: on a phone this is a screen, not
	 * a popover.
	 */
	type Entry = { name: string; path: string; isDataset: boolean; uid: number; gid: number };

	let {
		open = $bindable(false),
		start = '/mnt',
		title = 'Choose a location',
		onpick
	}: {
		open?: boolean;
		start?: string;
		title?: string;
		onpick?: (path: string) => void;
	} = $props();

	// Set from `start` by the effect below each time the sheet opens, so it
	// tracks the prop rather than freezing its first value.
	let path = $state('/mnt');
	let parent = $state<string | null>(null);
	let entries = $state<Entry[]>([]);
	let canCreateDataset = $state(false);
	let loading = $state(false);
	let error = $state('');

	let creating = $state<'dataset' | 'directory' | null>(null);
	let newName = $state('');
	let busy = $state(false);

	// Reload whenever the sheet opens or the folder changes.
	$effect(() => {
		if (!open) return;
		void load(path);
	});

	// Reset to the requested starting point each time it's opened.
	$effect(() => {
		if (open) path = start;
	});

	async function load(target: string) {
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/paths/browse?path=${encodeURIComponent(target)}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			entries = body.entries ?? [];
			parent = body.parent ?? null;
			canCreateDataset = Boolean(body.canCreateDataset);
		} catch (e) {
			error = (e as Error).message;
			entries = [];
		} finally {
			loading = false;
		}
	}

	function into(entry: Entry) {
		creating = null;
		path = entry.path;
	}

	function up() {
		if (parent) {
			creating = null;
			path = parent;
		}
	}

	async function create() {
		const name = newName.trim();
		if (!name || !creating) return;
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
			error = 'Use letters, numbers, dots, dashes or underscores.';
			return;
		}
		busy = true;
		error = '';
		try {
			const target = `${path}/${name}`;
			const res = await fetch('/api/paths/provision', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: target, kind: creating, from: path })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			// Select what was just created — that's almost always the intent.
			creating = null;
			newName = '';
			open = false;
			onpick?.(target);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function useThis() {
		open = false;
		onpick?.(path);
	}
</script>

{#if open}
	<div
		class="scrim"
		role="button"
		tabindex="-1"
		aria-label="Close"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
		<div class="top">
			<button class="icon" onclick={up} disabled={!parent} aria-label="Up one level">←</button>
			<div class="crumbs">
				<div class="label">{title}</div>
				<code>{path}</code>
			</div>
			<button class="icon" onclick={() => (open = false)} aria-label="Close">×</button>
		</div>

		{#if error}<p class="err">{error}</p>{/if}

		<div class="list">
			{#if loading}
				<p class="dim">Loading…</p>
			{:else if entries.length === 0}
				<p class="dim">Nothing here yet.</p>
			{:else}
				{#each entries as e (e.path)}
					<button class="row" onclick={() => into(e)}>
						<span class="glyph" aria-hidden="true">{e.isDataset ? '▦' : '▸'}</span>
						<span class="name">{e.name}</span>
						{#if e.isDataset}<span class="tag">dataset</span>{/if}
						<span class="chev" aria-hidden="true">›</span>
					</button>
				{/each}
			{/if}
		</div>

		{#if creating}
			<div class="create">
				<label for="pp-name">
					New {creating === 'dataset' ? 'dataset' : 'folder'} in <code>{path}</code>
				</label>
				<div class="createrow">
					<input
						id="pp-name"
						class="text"
						bind:value={newName}
						placeholder="name"
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
					/>
					<button class="go" disabled={busy || !newName.trim()} onclick={create}>
						{busy ? '…' : 'Create'}
					</button>
				</div>
				<button class="link" onclick={() => (creating = null)}>Cancel</button>
			</div>
		{:else}
			<div class="actions">
				{#if canCreateDataset}
					<button class="ghost" onclick={() => (creating = 'dataset')}>+ Dataset</button>
				{/if}
				{#if path !== '/mnt'}
					<button class="ghost" onclick={() => (creating = 'directory')}>+ Folder</button>
					<button class="go grow" onclick={useThis}>Use this</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 50;
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 51;
		display: flex;
		flex-direction: column;
		max-height: 88dvh;
		background: var(--surface-2);
		border-top-left-radius: var(--r-lg);
		border-top-right-radius: var(--r-lg);
		border-top: 1px solid var(--border);
		box-shadow: var(--shadow);
		animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 12px 10px;
		border-bottom: 1px solid var(--border);
	}
	.crumbs {
		flex: 1;
		min-width: 0;
	}
	.crumbs .label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.crumbs code {
		display: block;
		font-family: var(--mono);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.icon {
		flex: none;
		width: 40px;
		height: 40px;
		min-height: 40px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-3);
		color: var(--text);
		font-size: 18px;
	}
	.icon:disabled {
		opacity: 0.4;
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px 8px;
		-webkit-overflow-scrolling: touch;
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 10px;
		border: 0;
		background: transparent;
		border-radius: var(--r-sm);
		text-align: left;
		color: var(--text);
	}
	.row:active {
		background: var(--surface-3);
	}
	.glyph {
		flex: none;
		color: var(--accent);
		font-size: 13px;
	}
	.name {
		flex: 1;
		min-width: 0;
		font-size: 15px;
		overflow-wrap: anywhere;
	}
	.tag {
		flex: none;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 7px;
		border-radius: 999px;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.chev {
		flex: none;
		color: var(--text-faint);
	}

	.actions,
	.create {
		padding: 10px 12px calc(14px + var(--sa-bottom));
		border-top: 1px solid var(--border);
		display: flex;
		gap: 8px;
	}
	.create {
		flex-direction: column;
	}
	.createrow {
		display: flex;
		gap: 8px;
	}
	.create label {
		font-size: 13px;
		color: var(--text-dim);
	}
	.text {
		flex: 1;
		min-height: 44px;
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font: inherit;
		font-size: 15px;
		padding: 8px 12px;
	}
	button.ghost,
	button.go {
		min-height: 46px;
		padding: 0 16px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-3);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
	}
	button.go {
		border-color: transparent;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	button.go.grow {
		flex: 1;
	}
	button.go:disabled {
		opacity: 0.45;
	}
	button.link {
		align-self: flex-start;
		border: 0;
		background: transparent;
		color: var(--text-dim);
		font-size: 13px;
		min-height: 32px;
		padding: 0;
	}

	.err {
		margin: 10px 12px 0;
		color: var(--danger);
		font-size: 13px;
	}
	.dim {
		color: var(--text-dim);
		padding: 14px 10px;
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}
</style>
