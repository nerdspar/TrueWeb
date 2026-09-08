<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { AppRecord } from '$lib/server/truenas/methods';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { postAction, resolveUpdateAction, updateKind } from '$lib/client/actions';

	let { data }: { data: PageData } = $props();

	type Phase = 'queued' | 'running' | 'done' | 'failed';

	/** How long to wait on a single app before giving up and moving on. Image
	 *  pulls can be genuinely slow, so this is generous. */
	const JOB_TIMEOUT_MS = 15 * 60_000;

	let selected = $state<Record<string, boolean>>({});
	let status = $state<Record<string, { phase: Phase; pct?: number; message?: string }>>({});
	let running = $state(false);
	let toastMsg = $state('');

	let confirmOpen = $state(false);
	let confirmProps = $state({ title: '', message: '', confirmLabel: 'Update', danger: false });

	const queue: string[] = [];
	const jobToApp = new Map<number, string>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	const apps = $derived(data.apps);
	const selectedIds = $derived(apps.filter((a) => selected[a.id]).map((a) => a.id));
	const allSelected = $derived(apps.length > 0 && selectedIds.length === apps.length);
	const doneCount = $derived(
		Object.values(status).filter((s) => s.phase === 'done' || s.phase === 'failed').length
	);
	const totalQueued = $derived(Object.keys(status).length);

	function toggleAll() {
		if (allSelected) {
			selected = {};
		} else {
			const next: Record<string, boolean> = {};
			for (const a of apps) next[a.id] = true;
			selected = next;
		}
	}

	function setStatus(id: string, patch: { phase: Phase; pct?: number; message?: string }) {
		status = { ...status, [id]: patch };
	}

	// ── the bulk run ───────────────────────────────────────────────────────

	function askBulk() {
		const chosen = apps.filter((a) => selected[a.id]);
		if (chosen.length === 0) return;
		const names = chosen.slice(0, 4).map((a) => a.name).join(', ');
		const more = chosen.length > 4 ? ` and ${chosen.length - 4} more` : '';
		confirmProps = {
			title: `Update ${chosen.length} app${chosen.length === 1 ? '' : 's'}?`,
			message: `${names}${more} will be updated and redeployed, one at a time.`,
			confirmLabel: 'Update',
			danger: false
		};
		confirmOpen = true;
	}

	function startBulk() {
		const chosen = apps.filter((a) => selected[a.id] && resolveUpdateAction(a));
		if (chosen.length === 0) return;

		queue.length = 0;
		const fresh: typeof status = {};
		for (const a of chosen) {
			queue.push(a.id);
			fresh[a.id] = { phase: 'queued' };
		}
		status = fresh;
		running = true;
		void processNext();
	}

	async function processNext(): Promise<void> {
		const id = queue.shift();
		if (id === undefined) {
			running = false;
			return;
		}
		const app = apps.find((a) => a.id === id);
		const action = app ? resolveUpdateAction(app) : null;
		if (!app || !action) {
			setStatus(id, { phase: 'failed', message: 'No update path for this app.' });
			return processNext();
		}

		setStatus(id, { phase: 'running' });
		try {
			const jobId = await postAction(app.name, action);
			if (typeof jobId !== 'number') {
				// No job id came back; treat it as dispatched and move on.
				setStatus(id, { phase: 'done' });
				return processNext();
			}
			jobToApp.set(jobId, id);
			timers.set(
				id,
				setTimeout(() => {
					if (status[id]?.phase === 'running') {
						setStatus(id, { phase: 'failed', message: 'Timed out waiting for the job.' });
						jobToApp.delete(jobId);
						void processNext();
					}
				}, JOB_TIMEOUT_MS)
			);
		} catch (err) {
			setStatus(id, { phase: 'failed', message: (err as Error).message });
			return processNext();
		}
	}

	function finish(id: string, jobId: number, phase: Phase, message?: string) {
		jobToApp.delete(jobId);
		const t = timers.get(id);
		if (t) {
			clearTimeout(t);
			timers.delete(id);
		}
		setStatus(id, { phase, message });
		void processNext();
	}

	onMount(() => {
		if (!data.configured) return;
		const es = new EventSource('/api/stream');
		es.addEventListener('job', (e) => {
			const job = JSON.parse((e as MessageEvent).data) as {
				id?: number;
				state?: string;
				error?: string | null;
				progress?: { percent?: number };
			};
			if (typeof job.id !== 'number') return;
			const id = jobToApp.get(job.id);
			if (!id) return;

			if (job.state === 'SUCCESS') finish(id, job.id, 'done');
			else if (job.state === 'FAILED' || job.state === 'ABORTED')
				finish(id, job.id, 'failed', job.error ?? job.state);
			else if (typeof job.progress?.percent === 'number')
				setStatus(id, { phase: 'running', pct: job.progress.percent });
		});
		return () => es.close();
	});
</script>

<header class="head">
	<a class="back" href="/apps" aria-label="Back to apps">←</a>
	<div class="title">
		<h1>Updates</h1>
		<div class="sub">
			{#if running}
				{doneCount} of {totalQueued} done
			{:else}
				{apps.length} app{apps.length === 1 ? '' : 's'} with updates
			{/if}
		</div>
	</div>
	{#if apps.length > 0 && !running}
		<button class="linkish" onclick={toggleAll}>
			{allSelected ? 'Deselect all' : 'Select all'}
		</button>
	{/if}
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else if apps.length === 0}
	<div class="empty">
		<div class="icon">✓</div>
		<h2>Everything is up to date</h2>
		<p class="dim">No apps have updates waiting.</p>
		<p><a href="/apps">Back to apps</a></p>
	</div>
{:else}
	<ul class="list">
		{#each apps as app (app.id)}
			{@const st = status[app.id]}
			<li class="row">
				<label class="pick">
					<input
						type="checkbox"
						checked={Boolean(selected[app.id])}
						disabled={running}
						onchange={(e) => (selected = { ...selected, [app.id]: e.currentTarget.checked })}
					/>
					<span class="meta">
						<span class="name">
							{app.name}
							<span class="kind">{updateKind(app)}</span>
						</span>
						{#if app.human_version}<span class="ver">{app.human_version}</span>{/if}
					</span>
				</label>

				{#if st}
					<span class="status" data-phase={st.phase}>
						{#if st.phase === 'queued'}
							queued
						{:else if st.phase === 'running'}
							<span class="spin" aria-hidden="true"></span>{st.pct ? `${st.pct}%` : 'working'}
						{:else if st.phase === 'done'}
							✓ done
						{:else}
							✗ failed
						{/if}
					</span>
				{/if}
			</li>
			{#if st?.phase === 'failed' && st.message}
				<li class="failmsg">{st.message}</li>
			{/if}
		{/each}
	</ul>

	<div class="bar">
		<button class="go" disabled={running || selectedIds.length === 0} onclick={askBulk}>
			{#if running}
				Updating… {doneCount}/{totalQueued}
			{:else}
				Update {selectedIds.length} app{selectedIds.length === 1 ? '' : 's'}
			{/if}
		</button>
	</div>
{/if}

<ConfirmSheet
	bind:open={confirmOpen}
	title={confirmProps.title}
	message={confirmProps.message}
	confirmLabel={confirmProps.confirmLabel}
	danger={confirmProps.danger}
	onconfirm={startBulk}
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
	}
	.sub {
		font-size: 12px;
		color: var(--text-faint);
	}
	.linkish {
		flex: none;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		border-radius: 999px;
		padding: 8px 12px;
		font-size: 13px;
		font-weight: 600;
		min-height: 40px;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0 0 96px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 4px 16px;
		border-bottom: 1px solid var(--border);
		min-height: 60px;
	}
	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		cursor: pointer;
	}
	input[type='checkbox'] {
		flex: none;
		width: 22px;
		height: 22px;
		accent-color: var(--accent);
	}
	.meta {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.name {
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.kind {
		font-size: 10px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 5px;
		color: var(--text-dim);
		background: var(--surface-3);
	}
	.ver {
		font-size: 12px;
		color: var(--text-faint);
	}

	.status {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-faint);
	}
	.status[data-phase='running'] {
		color: var(--info);
	}
	.status[data-phase='done'] {
		color: var(--ok);
	}
	.status[data-phase='failed'] {
		color: var(--danger);
	}
	.failmsg {
		list-style: none;
		padding: 0 16px 10px 50px;
		font-size: 12px;
		color: var(--danger);
		border-bottom: 1px solid var(--border);
		overflow-wrap: anywhere;
	}
	.spin {
		width: 12px;
		height: 12px;
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

	.bar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--nav-h) + var(--sa-bottom));
		z-index: 15;
		padding: 10px 16px 12px;
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
	}
	.go {
		width: 100%;
		min-height: 50px;
		border: none;
		border-radius: var(--r);
		font-size: 16px;
		font-weight: 700;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.go:disabled {
		opacity: 0.45;
	}

	.empty {
		text-align: center;
		padding: 64px 24px;
	}
	.empty .icon {
		font-size: 36px;
	}
	.empty h2 {
		margin: 12px 0 6px;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
