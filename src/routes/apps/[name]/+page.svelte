<script lang="ts">
	import type { PageData } from './$types';
	import type { AppStats, LogLine, UpgradeSummary } from '$lib/server/truenas/methods';
	import StateBadge from '$lib/components/StateBadge.svelte';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import OptionSheet from '$lib/components/OptionSheet.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import {
		postAction,
		formatBytes,
		formatPercent,
		confirmMessage,
		resolveUpdateAction,
		VERB,
		GERUND,
		NEEDS_CONFIRM,
		type Action
	} from '$lib/client/actions';

	let { data }: { data: PageData } = $props();

	const MAX_LOG_LINES = 500;

	let liveState = $state<string | null>(null);
	let stats = $state<AppStats | null>(null);
	let logs = $state<LogLine[]>([]);
	// Defaults to the first container, until the viewer picks another.
	let chosenContainer = $state<string | null>(null);
	const container = $derived(chosenContainer ?? data.containers[0]?.id ?? '');
	let pendingAction = $state<Action | null>(null);
	let pendingPct = $state<number | undefined>(undefined);
	let pendingJob: number | null = null;
	let toastMsg = $state('');
	let logEl = $state<HTMLElement | null>(null);
	let follow = $state(true);

	let confirmOpen = $state(false);
	let confirmProps = $state({ title: '', message: '', confirmLabel: 'Confirm', danger: false });
	let confirmRun: (() => void) | null = null;

	// Upgrade summary + rollback versions, fetched on demand — an upgrade summary
	// hits the catalog, so it isn't worth paying for on every page open.
	let versionInfo = $state<{ summary: UpgradeSummary | null; rollback: string[] } | null>(null);
	let loadingVersions = $state(false);
	let rollbackOpen = $state(false);

	const app = $derived(data.app);
	// NB: must not be called `state` — a variable of that name turns every
	// `$state(...)` rune into `$`-store-subscription syntax on it.
	const appState = $derived(liveState ?? app?.state ?? 'STOPPED');
	const isRunning = $derived(appState === 'RUNNING');
	const transitional = $derived(appState === 'DEPLOYING' || appState === 'STOPPING');
	const busy = $derived(Boolean(pendingAction) || transitional);
	// Which update this app actually needs — catalog upgrade vs image pull (§3.5).
	const updateAction = $derived(app ? resolveUpdateAction(app) : null);
	const train = $derived(
		typeof app?.metadata?.train === 'string' ? (app.metadata.train as string) : null
	);
	const portals = $derived(app?.portals ?? {});

	// ── live stream ────────────────────────────────────────────────────────
	$effect(() => {
		if (!data.configured || !app) return;
		const qs = container ? `?container=${encodeURIComponent(container)}` : '';
		const es = new EventSource(`/api/apps/${encodeURIComponent(data.name)}/stream${qs}`);

		es.addEventListener('app', (e) => {
			const { fields } = JSON.parse((e as MessageEvent).data);
			if (typeof fields?.state === 'string') liveState = fields.state;
		});
		es.addEventListener('stats', (e) => {
			stats = JSON.parse((e as MessageEvent).data) as AppStats;
		});
		es.addEventListener('log', (e) => {
			const line = JSON.parse((e as MessageEvent).data) as LogLine;
			logs = [...logs, line].slice(-MAX_LOG_LINES);
		});
		es.addEventListener('job', (e) => {
			const job = JSON.parse((e as MessageEvent).data);
			if (pendingJob === null || job.id !== pendingJob) return;
			if (typeof job.progress?.percent === 'number') pendingPct = job.progress.percent;
			if (job.state === 'FAILED' || job.state === 'ABORTED') {
				toastMsg = `${VERB[pendingAction ?? 'start']} failed.`;
				clearPending();
			} else if (job.state === 'SUCCESS') {
				clearPending();
			}
		});

		return () => es.close();
	});

	// Keep the log tail pinned to the bottom while the user hasn't scrolled up.
	$effect(() => {
		logs.length; // track
		if (follow && logEl) logEl.scrollTop = logEl.scrollHeight;
	});

	function onLogScroll() {
		if (!logEl) return;
		follow = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
	}

	function clearPending() {
		pendingAction = null;
		pendingPct = undefined;
		pendingJob = null;
	}

	async function ensureVersions() {
		if (versionInfo) return versionInfo;
		loadingVersions = true;
		try {
			const res = await fetch(`/api/apps/${encodeURIComponent(data.name)}/versions`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			versionInfo = await res.json();
			return versionInfo;
		} catch (err) {
			toastMsg = `Couldn't load version info: ${(err as Error).message}`;
			return null;
		} finally {
			loadingVersions = false;
		}
	}

	/** Changelogs arrive as markup; render them as readable plain text. */
	function excerpt(text: string | null | undefined, max = 320): string {
		if (!text) return '';
		const flat = text
			.replace(/<[^>]*>/g, '')
			.replace(/\s+\n/g, '\n')
			.trim();
		return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
	}

	/** §5.1: show what an upgrade changes before running it. */
	async function requestUpgrade() {
		if (!app) return;
		const info = await ensureVersions();
		const s = info?.summary;
		const from = app.human_version ?? app.version ?? 'current';
		const to = s?.upgrade_human_version ?? s?.latest_human_version ?? 'latest';
		const notes = excerpt(s?.available_versions_for_upgrade?.[0]?.changelog);
		confirmProps = {
			title: `Update ${app.name}?`,
			message: `${from}  →  ${to}${notes ? `\n\n${notes}` : ''}`,
			confirmLabel: 'Update',
			danger: false
		};
		confirmRun = () => runAction('upgrade');
		confirmOpen = true;
	}

	async function openRollback() {
		const info = await ensureVersions();
		const list = info?.rollback ?? [];
		if (list.length === 0) {
			toastMsg = 'No previous versions are available to roll back to.';
			return;
		}
		rollbackOpen = true;
	}

	function chooseRollback(version: string) {
		if (!app) return;
		confirmProps = {
			title: `Roll back ${app.name}?`,
			message: `Roll back to ${version}. A snapshot is taken first.`,
			confirmLabel: 'Roll back',
			danger: true
		};
		confirmRun = () => runAction('rollback', { version });
		confirmOpen = true;
	}

	function requestAction(action: Action) {
		if (!app) return;
		// A catalog upgrade shows its summary first (§5.1).
		if (action === 'upgrade') {
			void requestUpgrade();
			return;
		}
		if (NEEDS_CONFIRM[action]) {
			confirmProps = {
				title: `${VERB[action]} ${app.name}?`,
				message: confirmMessage(action),
				confirmLabel: VERB[action],
				danger: action === 'stop'
			};
			confirmRun = () => runAction(action);
			confirmOpen = true;
		} else {
			runAction(action);
		}
	}

	async function runAction(action: Action, payload?: Record<string, unknown>) {
		if (!app) return;
		pendingAction = action;
		pendingPct = undefined;
		try {
			const jobId = await postAction(app.name, action, payload);
			pendingJob = jobId ?? null;
		} catch (err) {
			toastMsg = `${VERB[action]} failed: ${(err as Error).message}`;
			clearPending();
		}
	}
</script>

<header class="head">
	<a class="back" href="/" aria-label="Back to apps">←</a>
	<div class="title">
		<h1>{data.name}</h1>
		{#if app}
			<div class="sub">{app.human_version ?? app.version ?? ''}</div>
		{/if}
	</div>
	{#if pendingAction}
		<span class="pending"><span class="spin" aria-hidden="true"></span>
			{GERUND[pendingAction]}{pendingPct ? ` ${pendingPct}%` : '…'}</span>
	{:else if app}
		<StateBadge state={appState} />
	{/if}
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else if !app}
	<div class="empty">
		<div class="icon">🔍</div>
		<h2>App not found</h2>
		<p class="dim">No app named <code>{data.name}</code> is installed.</p>
		<p><a href="/">Back to apps</a></p>
	</div>
{:else}
	<div class="actions">
		{#if isRunning}
			<button class="act danger" disabled={busy} onclick={() => requestAction('stop')}>■ Stop</button>
			<button class="act" disabled={busy} onclick={() => requestAction('restart')}>↻ Restart</button>
		{:else}
			<button class="act go" disabled={busy} onclick={() => requestAction('start')}>▶ Start</button>
		{/if}
		{#if updateAction}
			<button class="act update" disabled={busy} onclick={() => requestAction(updateAction)}>
				⬆ Update
			</button>
		{/if}
		{#if !app.custom_app}
			<!-- Rollback is a catalog-version concept, so it isn't offered on a
			     custom app (§3.5). Versions are fetched on tap. -->
			<button class="act" disabled={busy || loadingVersions} onclick={openRollback}>
				{loadingVersions ? '… Rollback' : '⟲ Rollback'}
			</button>
		{/if}
	</div>

	<section class="card">
		<h2>Live</h2>
		{#if stats}
			<div class="metrics">
				<div class="metric">
					<span class="k">CPU</span>
					<span class="v">{formatPercent(stats.cpu_usage)}%</span>
				</div>
				<div class="metric">
					<span class="k">Memory</span>
					<span class="v">{formatBytes(stats.memory)}</span>
				</div>
				<div class="metric">
					<span class="k">Net ↓</span>
					<span class="v">{formatBytes(stats.networks?.[0]?.rx_bytes)}/s</span>
				</div>
				<div class="metric">
					<span class="k">Net ↑</span>
					<span class="v">{formatBytes(stats.networks?.[0]?.tx_bytes)}/s</span>
				</div>
			</div>
		{:else}
			<p class="dim small">
				{isRunning ? 'Waiting for the first stats sample…' : 'Not running.'}
			</p>
		{/if}
	</section>

	<section class="card">
		<h2>Details</h2>
		<dl>
			<div><dt>Type</dt><dd>{app.custom_app ? 'Custom (compose)' : 'Catalog'}</dd></div>
			{#if train}<div><dt>Train</dt><dd>{train}</dd></div>{/if}
			{#if app.version}<div><dt>Version</dt><dd>{app.version}</dd></div>{/if}
			{#if data.hostIps.length}
				<div><dt>Host IPs</dt><dd>{data.hostIps.join(', ')}</dd></div>
			{/if}
			{#if Object.keys(portals).length}
				<div>
					<dt>Portals</dt>
					<dd class="links">
						{#each Object.entries(portals) as [label, href] (label)}
							<a {href} target="_blank" rel="noopener noreferrer">{label} ↗</a>
						{/each}
					</dd>
				</div>
			{/if}
			{#if app.notes}<div><dt>Notes</dt><dd class="notes">{app.notes}</dd></div>{/if}
		</dl>
	</section>

	<section class="card">
		<h2>Containers</h2>
		{#if data.containers.length === 0}
			<p class="dim small">No running containers.</p>
		{:else}
			<ul class="containers">
				{#each data.containers as c (c.id)}
					<li>
						<div class="cmeta">
							<div class="cname">{c.service_name}</div>
							<div class="cimage">{c.image}</div>
						</div>
						<span class="cstate" data-state={c.state}>{c.state}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card logs">
		<div class="logshead">
			<h2>Logs</h2>
			{#if data.containers.length > 1}
				<select
					value={container}
					onchange={(e) => (chosenContainer = e.currentTarget.value)}
					aria-label="Container"
				>
					{#each data.containers as c (c.id)}
						<option value={c.id}>{c.service_name}</option>
					{/each}
				</select>
			{/if}
		</div>
		{#if !container}
			<p class="dim small">No container to follow.</p>
		{:else}
			<pre bind:this={logEl} onscroll={onLogScroll}>{#each logs as l, i (i)}{l.data}
{/each}</pre>
			{#if logs.length === 0}
				<p class="dim small">Waiting for log output…</p>
			{/if}
			{#if !follow}
				<button class="jump" onclick={() => { follow = true; if (logEl) logEl.scrollTop = logEl.scrollHeight; }}>
					↓ Jump to latest
				</button>
			{/if}
		{/if}
	</section>
{/if}

<OptionSheet
	bind:open={rollbackOpen}
	title="Roll back to"
	options={(versionInfo?.rollback ?? []).map((v) => ({ key: v, label: v }))}
	onselect={chooseRollback}
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

	.actions {
		display: flex;
		gap: 8px;
		padding: 14px 16px 4px;
		flex-wrap: wrap;
	}
	.act {
		flex: 1;
		min-width: 96px;
		min-height: 46px;
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

	.metrics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.metric {
		background: var(--surface-2);
		border-radius: var(--r-sm);
		padding: 10px 12px;
	}
	.metric .k {
		display: block;
		font-size: 11px;
		color: var(--text-faint);
	}
	.metric .v {
		font-size: 18px;
		font-weight: 700;
	}

	dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	dl div {
		display: flex;
		gap: 12px;
		align-items: baseline;
	}
	dt {
		flex: none;
		width: 84px;
		color: var(--text-faint);
		font-size: 13px;
	}
	dd {
		margin: 0;
		flex: 1;
		min-width: 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}
	.links {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.notes {
		white-space: pre-wrap;
		color: var(--text-dim);
		font-size: 13px;
	}

	.containers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.containers li {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.cmeta {
		flex: 1;
		min-width: 0;
	}
	.cname {
		font-weight: 600;
		font-size: 14px;
	}
	.cimage {
		font-size: 11px;
		color: var(--text-faint);
		font-family: var(--mono);
		overflow-wrap: anywhere;
	}
	.cstate {
		flex: none;
		font-size: 11px;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: 999px;
		background: var(--surface-3);
		color: var(--text-dim);
	}
	.cstate[data-state='running'] {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 14%, transparent);
	}
	.cstate[data-state='exited'],
	.cstate[data-state='crashed'] {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 14%, transparent);
	}

	.logshead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.logshead h2 {
		margin: 0 0 10px;
	}
	select {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 6px 8px;
		font: inherit;
		font-size: 13px;
		margin-bottom: 10px;
	}
	pre {
		margin: 0;
		max-height: 45vh;
		overflow: auto;
		background: #04050a;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 10px;
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.5;
		color: #cfd6e6;
		white-space: pre;
		-webkit-overflow-scrolling: touch;
	}
	.jump {
		margin-top: 8px;
		width: 100%;
		min-height: 40px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
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
	.small {
		font-size: 13px;
	}
	code {
		font-family: var(--mono);
		font-size: 13px;
	}
</style>
