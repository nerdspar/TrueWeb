<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { AppRecord, AppState } from '$lib/server/truenas/methods';
	import StateBadge from '$lib/components/StateBadge.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import SortSheet from '$lib/components/SortSheet.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import {
		postAction,
		confirmMessage,
		resolveUpdateAction,
		VERB,
		GERUND,
		NEEDS_CONFIRM,
		type Action
	} from '$lib/client/actions';

	let { data }: { data: PageData } = $props();

	type Filter = 'all' | 'running' | 'stopped' | 'updates';
	type Sort = 'state' | 'name' | 'recent';

	// Live list: the SSR snapshot (data.apps) with SSE deltas layered on top —
	// `overrides` patches known apps, `extras` holds ones that appeared live,
	// `removed` hides ones that went away. Deriving (rather than seeding a single
	// $state from a prop) means a reload can't clobber live state and the first
	// paint already has the server's list.
	let overrides = $state<Record<string, Partial<AppRecord>>>({});
	let extras = $state<AppRecord[]>([]);
	let removed = $state<string[]>([]);
	let filter = $state<Filter>('all');
	// Name is the default: a stable alphabetical list means a row doesn't jump
	// when its state changes under you (§5.1 offers state/name/recent).
	let sort = $state<Sort>('name');
	let sortOpen = $state(false);
	let toastMsg = $state('');

	// When we last saw each app change state (from the live stream), for the
	// "recently changed" sort. Populated by SSE, so it reflects this session.
	let changedAt = $state<Record<string, number>>({});

	// Rows with an action in flight: appId → the action + its job.
	let pending = $state<Record<string, { action: Action; pct?: number }>>({});
	const jobToApp = new Map<number, string>();
	const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

	// Confirm sheet (§6 tier-2).
	let confirmOpen = $state(false);
	let confirmProps = $state({ title: '', message: '', confirmLabel: 'Confirm', danger: false });
	let confirmRun: (() => void) | null = null;

	const hasUpdate = (a: AppRecord) => Boolean(a.upgrade_available || a.image_updates_available);
	const isRunning = (s: string) => s === 'RUNNING';
	const isTransitional = (s: string) => s === 'DEPLOYING' || s === 'STOPPING';

	const STATE_ORDER: Record<string, number> = {
		CRASHED: 0,
		STOPPED: 1,
		STOPPING: 2,
		DEPLOYING: 3,
		RUNNING: 4
	};

	const apps = $derived.by(() => {
		const rm = new Set(removed);
		const baseIds = new Set(data.apps.map((a) => a.id));
		const merged: AppRecord[] = [];
		for (const a of data.apps) {
			if (!rm.has(a.id)) merged.push({ ...a, ...overrides[a.id] });
		}
		for (const a of extras) {
			if (!baseIds.has(a.id) && !rm.has(a.id)) merged.push({ ...a, ...overrides[a.id] });
		}
		return merged;
	});

	const pendingUpdates = $derived(apps.filter(hasUpdate).length);

	const filtered = $derived.by(() => {
		let list = [...apps];
		if (filter === 'running') list = list.filter((a) => a.state === 'RUNNING');
		else if (filter === 'stopped')
			list = list.filter((a) => a.state === 'STOPPED' || a.state === 'CRASHED');
		else if (filter === 'updates') list = list.filter(hasUpdate);

		list.sort((a, b) => {
			if (sort === 'name') return a.name.localeCompare(b.name);
			if (sort === 'recent')
				return (changedAt[b.id] ?? 0) - (changedAt[a.id] ?? 0) || a.name.localeCompare(b.name);
			return (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || a.name.localeCompare(b.name);
		});
		return list;
	});

	const chips: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'running', label: 'Running' },
		{ key: 'stopped', label: 'Stopped' },
		{ key: 'updates', label: 'Updates' }
	];

	const SORT_OPTS = [
		{ key: 'state', label: 'State', hint: 'Stopped & erroring first' },
		{ key: 'name', label: 'Name', hint: 'A–Z' },
		{ key: 'recent', label: 'Recently changed', hint: 'Most recent first' }
	];
	const sortLabel = $derived(SORT_OPTS.find((o) => o.key === sort)?.label ?? 'Name');

	const dockerHealthy = $derived(data.docker?.status === 'RUNNING');

	// ── live updates ─────────────────────────────────────────────────────────

	function onAppEvent(msg: string, id: string, fields: Partial<AppRecord> | undefined) {
		if (!id) return;
		if (msg === 'removed') {
			if (!removed.includes(id)) removed = [...removed, id];
			clearPending(id);
			return;
		}
		if (removed.includes(id)) removed = removed.filter((r) => r !== id);

		const known = data.apps.some((a) => a.id === id) || extras.some((a) => a.id === id);
		if (known) {
			overrides = { ...overrides, [id]: { ...overrides[id], ...fields } };
		} else {
			extras = [
				...extras,
				{
					id,
					name: (fields?.name as string) ?? id,
					state: (fields?.state as AppState) ?? 'STOPPED',
					...fields
				}
			];
		}
		changedAt = { ...changedAt, [id]: Date.now() };
	}

	function onJobEvent(job: { id?: number; state?: string; method?: string; progress?: { percent?: number } }) {
		if (typeof job.id !== 'number') return;
		const appId = jobToApp.get(job.id);
		if (!appId || !pending[appId]) return;

		if (typeof job.progress?.percent === 'number') {
			pending[appId] = { ...pending[appId], pct: job.progress.percent };
		}
		if (job.state === 'FAILED' || job.state === 'ABORTED') {
			toastMsg = `${VERB[pending[appId].action]} failed for ${appId}.`;
			clearPending(appId, job.id);
		} else if (job.state === 'SUCCESS') {
			// State is (or will be) corrected by the app.query stream.
			clearPending(appId, job.id);
		}
	}

	function clearPending(appId: string, jobId?: number) {
		if (jobId !== undefined) jobToApp.delete(jobId);
		const timer = pendingTimers.get(appId);
		if (timer) {
			clearTimeout(timer);
			pendingTimers.delete(appId);
		}
		const next = { ...pending };
		delete next[appId];
		pending = next;
	}

	onMount(() => {
		// Restore the saved sort (§8: sort order may live in localStorage).
		try {
			const saved = localStorage.getItem('trueweb.sort');
			if (saved === 'state' || saved === 'name' || saved === 'recent') sort = saved;
		} catch {
			/* private mode / blocked storage — fall back to the default */
		}

		if (!data.configured) return;
		const es = new EventSource('/api/stream');
		es.addEventListener('app', (e) => {
			const { msg, id, fields } = JSON.parse((e as MessageEvent).data);
			onAppEvent(msg, String(id ?? fields?.id ?? ''), fields);
		});
		es.addEventListener('job', (e) => onJobEvent(JSON.parse((e as MessageEvent).data)));
		return () => es.close();
	});

	// Persist the sort choice whenever it changes.
	$effect(() => {
		try {
			localStorage.setItem('trueweb.sort', sort);
		} catch {
			/* ignore */
		}
	});

	// ── actions ────────────────────────────────────────────────────────────

	function requestAction(app: AppRecord, action: Action) {
		if (!NEEDS_CONFIRM[action]) {
			runAction(app, action); // start / restart are tier 1 — one tap
			return;
		}
		askConfirm(
			{
				title: `${VERB[action]} ${app.name}?`,
				message: confirmMessage(action),
				confirmLabel: VERB[action],
				danger: action === 'stop'
			},
			() => runAction(app, action)
		);
	}

	async function runAction(app: AppRecord, action: Action) {
		pending = { ...pending, [app.id]: { action } };
		// Safety: never leave a row stuck pending if no job event arrives.
		pendingTimers.set(
			app.id,
			setTimeout(() => clearPending(app.id), 5 * 60_000)
		);

		try {
			const jobId = await postAction(app.name, action);
			if (typeof jobId === 'number') jobToApp.set(jobId, app.id);
		} catch (err) {
			toastMsg = `${VERB[action]} failed for ${app.name}: ${(err as Error).message}`;
			clearPending(app.id);
		}
	}

	function askConfirm(props: Partial<typeof confirmProps>, run: () => void) {
		confirmProps = { title: 'Are you sure?', message: '', confirmLabel: 'Confirm', danger: false, ...props };
		confirmRun = run;
		confirmOpen = true;
	}
</script>

<header class="head">
	<div class="titlerow">
		<h1>Apps</h1>
		{#if data.reachable && pendingUpdates > 0}
			<a class="updates" href="/updates" title="Review and update these apps">
				{pendingUpdates} update{pendingUpdates === 1 ? '' : 's'}
			</a>
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
		<button class="chip sort" onclick={() => (sortOpen = true)} title="Change sort">
			↕ {sortLabel}
		</button>
	</div>

	{#if apps.length === 0}
		<Skeleton rows={4} />
		<p class="dim center">No apps installed.</p>
	{:else if filtered.length === 0}
		<p class="dim center">No apps match this filter.</p>
	{:else}
		<ul class="list">
			{#each filtered as app (app.id)}
				{@const p = pending[app.id]}
				{@const busy = Boolean(p) || isTransitional(app.state)}
				<li class="row">
					<div class="top">
						<a class="peek" href={`/apps/${encodeURIComponent(app.name)}`}>
							<div class="avatar" aria-hidden="true">{app.name.charAt(0).toUpperCase()}</div>
							<div class="meta">
								<div class="name">
									{app.name}
									{#if hasUpdate(app)}<span class="pill" title="Update available">⬆ update</span>{/if}
									{#if app.custom_app}<span class="pill ghost" title="Custom (compose) app">custom</span>{/if}
								</div>
								{#if app.human_version}<div class="ver">{app.human_version}</div>{/if}
							</div>
						</a>
						{#if p}
							<span class="pending" role="status">
								<span class="spin" aria-hidden="true"></span>
								{GERUND[p.action]}{p.pct ? ` ${p.pct}%` : '…'}
							</span>
						{:else}
							<StateBadge state={app.state} />
						{/if}
					</div>

					<div class="actions">
						{#if isRunning(app.state)}
							<button class="act danger" disabled={busy} onclick={() => requestAction(app, 'stop')}>
								■ Stop
							</button>
							<button class="act" disabled={busy} onclick={() => requestAction(app, 'restart')}>
								↻ Restart
							</button>
						{:else}
							<button
								class="act go"
								disabled={busy}
								onclick={() => requestAction(app, 'start')}
							>
								▶ Start
							</button>
						{/if}
						{#if hasUpdate(app)}
							{@const upd = resolveUpdateAction(app)}
							{#if upd}
								<button class="act update" disabled={busy} onclick={() => requestAction(app, upd)}>
									⬆ Update
								</button>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<SortSheet
	bind:open={sortOpen}
	current={sort}
	options={SORT_OPTS}
	onselect={(k) => (sort = k as Sort)}
/>
<ConfirmSheet
	bind:open={confirmOpen}
	title={confirmProps.title}
	message={confirmProps.message}
	confirmLabel={confirmProps.confirmLabel}
	danger={confirmProps.danger}
	onconfirm={() => confirmRun?.()}
/>
<Toast bind:message={toastMsg} />

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
		display: inline-flex;
		align-items: center;
		font-size: 13px;
		font-weight: 700;
		color: var(--on-accent);
		background: var(--accent-grad);
		padding: 6px 12px;
		border-radius: 999px;
		text-decoration: none;
		min-height: 32px;
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
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	/* Tapping the icon/name drills into the detail view; the badge and the
	   action buttons stay outside the link so one-tap actions still work. */
	.peek {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		color: inherit;
		text-decoration: none;
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
	.pending {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--info);
		white-space: nowrap;
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

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
		flex-wrap: wrap;
	}
	.act {
		flex: 1;
		min-width: 96px;
		min-height: 44px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
	}
	.act:disabled {
		opacity: 0.45;
	}
	.act.go {
		border-color: transparent;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.act.danger {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
	.act.update {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
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
