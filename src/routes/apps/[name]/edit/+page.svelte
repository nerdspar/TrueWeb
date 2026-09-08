<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import ComposeEditor from '$lib/components/ComposeEditor.svelte';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import JobFailure from '$lib/components/JobFailure.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { sanitizeCompose } from '$lib/compose/sanitize';
	import { inspectCompose } from '$lib/compose/inspect';
	import { diffLines, summarise, countChanges } from '$lib/compose/diff';

	let { data }: { data: PageData } = $props();

	const draftKey = $derived(`trueweb.edit-draft.${data.name}`);

	/**
	 * The loaded config stays the source of truth; `edited` overrides it once
	 * something is typed. Deriving rather than seeding $state from a prop keeps
	 * the diff honest and avoids capturing a stale first value.
	 */
	let edited = $state<string | null>(null);
	const yaml = $derived(edited ?? data.yaml);
	let notes = $state<string[]>([]);
	let toastMsg = $state('');
	let confirmOpen = $state(false);
	let saving = $state(false);
	let savePct = $state<number | undefined>(undefined);
	let saveJob: number | null = null;
	let failure = $state<{ error: string; exception: string } | null>(null);
	let showDiff = $state(false);

	const inspection = $derived(inspectCompose(yaml));
	const diff = $derived(diffLines(data.yaml, yaml));
	const changes = $derived(countChanges(diff));
	const dirty = $derived(changes.added > 0 || changes.removed > 0);
	const brief = $derived(summarise(diff, 2));
	const canSave = $derived(dirty && inspection.ok && !saving);

	// Draft per app, same reasoning as the paste screen (§5.2): a backgrounded
	// tab must not cost you an edit.
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const snapshot = yaml;
		clearTimeout(draftTimer);
		draftTimer = setTimeout(() => {
			try {
				if (snapshot === data.yaml) localStorage.removeItem(draftKey);
				else localStorage.setItem(draftKey, snapshot);
			} catch {
				/* private mode */
			}
		}, 400);
	});

	onMount(() => {
		try {
			const saved = localStorage.getItem(draftKey);
			if (saved && saved !== data.yaml) {
				edited = saved;
				toastMsg = 'Restored your unsaved edit.';
			}
		} catch {
			/* ignore */
		}

		if (!data.configured) return;
		const es = new EventSource('/api/stream');
		es.addEventListener('job', (e) => {
			const job = JSON.parse((e as MessageEvent).data) as {
				id?: number;
				state?: string;
				error?: string | null;
				exception?: string | null;
				progress?: { percent?: number };
			};
			if (saveJob === null || job.id !== saveJob) return;
			if (typeof job.progress?.percent === 'number') savePct = job.progress.percent;
			if (job.state === 'SUCCESS') {
				try {
					localStorage.removeItem(draftKey);
				} catch {
					/* ignore */
				}
				void goto(`/apps/${encodeURIComponent(data.name)}`);
			} else if (job.state === 'FAILED' || job.state === 'ABORTED') {
				saving = false;
				saveJob = null;
				failure = {
					error: job.error ?? 'The update failed.',
					exception: job.exception ?? ''
				};
			}
		});
		return () => es.close();
	});

	function runSanitize() {
		const r = sanitizeCompose(yaml);
		notes = r.changes;
		if (r.text !== yaml) edited = r.text;
	}

	function revert() {
		edited = null;
		notes = [];
		showDiff = false;
	}

	async function save() {
		if (!canSave) return;
		saving = true;
		failure = null;
		savePct = undefined;
		try {
			const res = await fetch(`/api/apps/${encodeURIComponent(data.name)}/config`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ compose: yaml })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			saveJob = typeof body.jobId === 'number' ? body.jobId : null;
			if (saveJob === null) void goto(`/apps/${encodeURIComponent(data.name)}`);
		} catch (err) {
			saving = false;
			failure = { error: (err as Error).message, exception: '' };
		}
	}
</script>

<header class="head">
	<a class="back" href={`/apps/${encodeURIComponent(data.name)}`} aria-label="Back to app">←</a>
	<div class="title">
		<h1>{data.name}</h1>
		<div class="sub">
			{#if dirty}
				+{changes.added} −{changes.removed}
			{:else}
				Compose configuration
			{/if}
		</div>
	</div>
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else if data.reason === 'not-found'}
	<div class="empty">
		<div class="icon">🔍</div>
		<h2>App not found</h2>
		<p><a href="/">Back to apps</a></p>
	</div>
{:else if !data.isCustom}
	<section class="card">
		<h2>Catalog app</h2>
		<p class="dim small">
			This app is installed from the catalog, so there's no compose file to edit — its settings are
			a values object validated against the catalog's own schema (§3.5). TrueWeb shows them
			read-only rather than reproducing that form.
		</p>
		<pre>{JSON.stringify(data.config, null, 2)}</pre>
		<p class="dim small">
			Converting it to a custom app is what unlocks YAML editing, and it's one-way — it severs the
			app from catalog updates. That isn't wired up here yet.
		</p>
	</section>
{:else}
	<section class="card">
		<h2>Compose</h2>
		<ComposeEditor value={yaml} onchange={(v) => (edited = v)} onpasted={runSanitize} rows={18} />
		<div class="row">
			<button class="ghost" onclick={runSanitize}>Clean up</button>
			{#if dirty}
				<button class="ghost" onclick={() => (showDiff = !showDiff)}>
					{showDiff ? 'Hide' : 'Show'} changes
				</button>
				<button class="ghost" onclick={revert}>Revert</button>
			{/if}
			{#if inspection.ok}
				<span class="ok">✓ {inspection.serviceNames.length} service{inspection.serviceNames.length === 1 ? '' : 's'}</span>
			{/if}
		</div>

		{#if notes.length > 0}
			<div class="notes">
				<strong>Fixed on paste</strong>
				<ul>
					{#each notes as n (n)}<li>{n}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if !inspection.ok}
			<p class="err">
				{#if inspection.error?.line}Line {inspection.error.line}: {/if}{inspection.error?.message}
			</p>
		{/if}

		<p class="dim small">
			TrueNAS stores the parsed compose, not the file you pasted, so comments and original
			formatting are not preserved — this is a re-serialisation of the current configuration.
			Environment values are shown as they are stored, secrets included.
		</p>
	</section>

	{#if showDiff && dirty}
		<section class="card">
			<h2>Changes</h2>
			<pre class="diff">{#each brief as line (`${line.kind}-${line.oldLine ?? 'x'}-${line.newLine ?? 'x'}-${line.text}`)}<span
						class={line.kind}
					>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '} {line.text}</span>
{/each}</pre>
		</section>
	{/if}

	{#if failure}
		<JobFailure
			title="Update failed"
			error={failure.error}
			exception={failure.exception}
			app={data.name}
			ondismiss={() => (failure = null)}
		/>
	{/if}

	<div class="bar">
		{#if saving}
			<div class="progress" role="status">
				<span class="spin" aria-hidden="true"></span>
				<span>Updating…{savePct ? ` ${savePct}%` : ''}</span>
			</div>
		{:else}
			<button class="save" disabled={!canSave} onclick={() => (confirmOpen = true)}>
				{dirty ? 'Save and redeploy' : 'No changes'}
			</button>
		{/if}
	</div>
{/if}

<ConfirmSheet
	bind:open={confirmOpen}
	title={`Update ${data.name}?`}
	message={`${changes.added} line${changes.added === 1 ? '' : 's'} added, ${changes.removed} removed. Saving redeploys the app.`}
	confirmLabel="Save and redeploy"
	onconfirm={save}
/>
<Toast bind:message={toastMsg} />

<style>
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
	.title {
		flex: 1;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 12px;
		color: var(--text-faint);
	}

	.card {
		margin: 12px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r);
	}
	.card h2 {
		margin: 0 0 10px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
		flex-wrap: wrap;
	}
	button.ghost {
		min-height: 44px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
	}
	.ok {
		margin-left: auto;
		color: var(--ok);
		font-size: 13px;
		font-weight: 600;
	}

	.notes {
		margin-top: 10px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--info) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--info) 32%, transparent);
		font-size: 13px;
	}
	.notes ul {
		margin: 4px 0 0;
		padding-left: 18px;
	}

	pre {
		margin: 10px 0 0;
		max-height: 45vh;
		overflow: auto;
		background: #04050a;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 10px;
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.55;
		color: #cfd6e6;
		white-space: pre;
		-webkit-overflow-scrolling: touch;
	}
	.diff span {
		display: block;
	}
	.diff .add {
		color: #7ee2a8;
		background: color-mix(in srgb, var(--ok) 12%, transparent);
	}
	.diff .remove {
		color: #ff9aa4;
		background: color-mix(in srgb, var(--danger) 12%, transparent);
	}
	.diff .same {
		color: var(--text-faint);
	}

	.err {
		margin: 8px 0 0;
		color: var(--danger);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
	}
	.small {
		font-size: 12px;
	}

	.bar {
		position: sticky;
		bottom: 0;
		padding: 10px 16px calc(12px + var(--sa-bottom));
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
	}
	.save {
		width: 100%;
		min-height: 52px;
		border: none;
		border-radius: var(--r);
		font-size: 16px;
		font-weight: 700;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.save:disabled {
		opacity: 0.45;
	}
	.progress {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 52px;
		font-size: 14px;
		font-weight: 600;
		color: var(--info);
	}
	.spin {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--info) 30%, transparent);
		border-top-color: var(--info);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty {
		text-align: center;
		padding: 64px 24px;
	}
	.empty .icon {
		font-size: 36px;
	}
</style>
