<script lang="ts">
	/**
	 * Dashboard (§5.4) — read-only, glanceable, answering one question: is this
	 * box healthy right now?
	 *
	 * Everything live comes from a single reporting.realtime subscription, opted
	 * into with ?realtime=1 so no other tab pays for the firehose.
	 */
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import Icon from '$lib/components/Icon.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { formatAgo, formatBytes, formatPercent, formatRate, formatUptime } from '$lib/client/actions';
	import { alertIso, alertMessage, alertTone, sortAlerts } from '$lib/dashboard/alerts';
	import {
		anyErrors,
		dataLayout,
		diskCount,
		formatLayout,
		groupCounts,
		mixedCapacity,
		poolErrors,
		totalErrors
	} from '$lib/storage/topology';
	import {
		aggregateCpu,
		hottestCpu,
		memoryBreakdown,
		peakCpuThread,
		poolHealth,
		poolUsedPercent,
		scanDuration,
		POOL_WARN_PERCENT,
		type RealtimeUpdate
	} from '$lib/dashboard/types';

	let { data }: { data: PageData } = $props();

	let live = $state<RealtimeUpdate | null>(null);
	/**
	 * Dismissals are tracked locally and subtracted from the loaded list, rather
	 * than copying `data.alerts` into state — a copy would silently ignore a
	 * reload of the page data.
	 */
	let dismissedIds = $state<string[]>([]);
	let dismissing = $state<Record<string, boolean>>({});
	const alerts = $derived(
		sortAlerts(data.alerts.filter((a) => !dismissedIds.includes(a.uuid)))
	);
	/** Seeded from the load on mount; the job stream owns it after that. */
	let jobs = $state<typeof data.jobs>([]);
	let toastMsg = $state('');

	const newVersion = $derived(data.update?.status?.new_version ?? null);

	/**
	 * Alerts, the update notice and running jobs are header icons rather than
	 * three stacked cards: they're usually empty or a single line, and as cards
	 * they pushed the things you actually came to look at — pools and live load
	 * — below the fold. The badge carries the state; the panel opens on demand,
	 * one at a time.
	 */
	let panel = $state<'alerts' | 'update' | 'jobs' | null>(null);
	const togglePanel = (which: 'alerts' | 'update' | 'jobs') =>
		(panel = panel === which ? null : which);

	/** The badge takes the worst severity present, so it can't under-report. */
	const alertTone_ = $derived.by(() => {
		const tones = alerts.map((a) => alertTone(a.level));
		if (tones.includes('danger')) return 'danger';
		if (tones.includes('warn')) return 'warn';
		return 'info';
	});
	/** Pool health by name, to merge over the live capacity figures. */
	const healthByName = $derived(new Map(data.pools.map((p) => [p.name, p])));

	async function dismiss(uuid: string) {
		dismissing = { ...dismissing, [uuid]: true };
		try {
			const res = await fetch('/api/alerts/dismiss', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uuid })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(body.message ?? 'The alert could not be dismissed.');
			}
			dismissedIds = [...dismissedIds, uuid];
		} catch (err) {
			toastMsg = (err as Error).message ?? 'Could not dismiss the alert.';
		} finally {
			const { [uuid]: _gone, ...rest } = dismissing;
			dismissing = rest;
		}
	}
	/** Set once the first sample lands, to tell "connecting" from "idle". */
	let seenSample = $state(false);

	const cpu = $derived(aggregateCpu(live?.cpu));
	const hottest = $derived(hottestCpu(live?.cpu));
	const busiest = $derived(peakCpuThread(live?.cpu));
	const threadCount = $derived(Object.keys(live?.cpu ?? {}).filter((k) => /^cpu\d+$/.test(k)).length);

	/**
	 * Memory is metered on *services* — what's actually spoken for — not on
	 * total-minus-free. ARC is most of the difference and ZFS gives it back on
	 * demand, so metering it would park this bar above 90% on a healthy box and
	 * teach you to ignore it.
	 */
	const mem = $derived(memoryBreakdown(live?.memory));
	const memPercent = $derived(mem ? (mem.services / mem.total) * 100 : null);

	/** Member disk sizes per pool, for the mixed-capacity note. */
	const sizesByPool = $derived.by(() => {
		const map = new Map<string, (number | null)[]>();
		for (const d of data.disks) {
			if (!d.pool) continue;
			map.set(d.pool, [...(map.get(d.pool) ?? []), d.size]);
		}
		return map;
	});

	/** Pools sorted fullest-first, because that's the one you care about. */
	const pools = $derived(
		Object.entries(live?.pools ?? {})
			.map(([name, p]) => {
				const percent = poolUsedPercent(p);
				const entry = healthByName.get(name);
				return {
					name,
					...p,
					percent,
					health: poolHealth(percent),
					// boot-pool shows up in the realtime feed but not in pool.query
					// (§5.5 reads it via boot.get_state), so health can be absent.
					status: entry?.status ?? null,
					// Health has no realtime equivalent, so it comes from pool.query —
					// and is shown always, not only once something is wrong.
					errors: poolErrors(entry?.topology),
					disks: diskCount(entry?.topology),
					degraded: entry ? !entry.healthy : false,
					warning: entry?.warning ?? false,
					fragmentation: entry?.fragmentation ?? null,
					scan: entry?.scan ?? null,
					layout: formatLayout(dataLayout(entry?.topology)),
					groups: groupCounts(entry?.topology),
					mixed: mixedCapacity(sizesByPool.get(name) ?? [])
				};
			})
			.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
	);

	/** Only interfaces that are actually up — a NAS has plenty that aren't. */
	const nics = $derived(
		Object.entries(live?.interfaces ?? {})
			.filter(([, n]) => n.link_state === 'LINK_STATE_UP')
			.sort(([a], [b]) => a.localeCompare(b))
	);

	onMount(() => {
		jobs = data.jobs;
		if (!data.configured) return;
		const es = new EventSource('/api/stream?realtime=1');
		es.addEventListener('realtime', (e) => {
			live = JSON.parse((e as MessageEvent).data) as RealtimeUpdate;
			seenSample = true;
		});
		es.addEventListener('job', (e) => {
			const job = JSON.parse((e as MessageEvent).data) as {
				id?: number;
				method?: string;
				state?: string;
				progress?: { percent?: number; description?: string | null };
			};
			if (typeof job.id !== 'number') return;
			const finished = job.state !== 'RUNNING' && job.state !== 'WAITING';
			if (finished) {
				jobs = jobs.filter((j) => j.id !== job.id);
				return;
			}
			const next = {
				id: job.id,
				method: job.method ?? '',
				state: job.state ?? 'RUNNING',
				description: job.progress?.description ?? null,
				progress: job.progress ?? null
			};
			jobs = jobs.some((j) => j.id === job.id)
				? jobs.map((j) => (j.id === job.id ? next : j))
				: [...jobs, next];
		});
		return () => es.close();
	});
</script>

<svelte:head><title>Dashboard · TrueWeb</title></svelte:head>

<header class="head">
	<h1>Dashboard</h1>
	{#if data.reachable}
		<div class="status">
			<button
				class="glyph"
				class:on={panel === 'alerts'}
				aria-expanded={panel === 'alerts'}
				aria-label={`Alerts: ${alerts.length}`}
				onclick={() => togglePanel('alerts')}
			>
				<Icon name="bell" size={20} />
				{#if alerts.length > 0}<span class="badge {alertTone_}">{alerts.length}</span>{/if}
			</button>
			<button
				class="glyph"
				class:on={panel === 'update'}
				aria-expanded={panel === 'update'}
				aria-label={newVersion ? `Update available: ${newVersion.version}` : 'No update available'}
				onclick={() => togglePanel('update')}
			>
				<Icon name="update" size={20} />
				{#if newVersion}<span class="badge info">1</span>{/if}
			</button>
			<button
				class="glyph"
				class:on={panel === 'jobs'}
				aria-expanded={panel === 'jobs'}
				aria-label={`Running jobs: ${jobs.length}`}
				onclick={() => togglePanel('jobs')}
			>
				<Icon name="activity" size={20} />
				{#if jobs.length > 0}<span class="badge accent">{jobs.length}</span>{/if}
			</button>
		</div>
	{/if}
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else}
	{#if panel === 'alerts'}
		<section class="card">
			<h2>Alerts</h2>
			{#if alerts.length === 0}
				<p class="dim small">No active alerts.</p>
			{/if}
			{#each alerts as a (a.uuid)}
				<div class="alert {alertTone(a.level)}">
					<div class="atext">
						<p>{alertMessage(a)}</p>
						<span class="ameta">{a.level} · {formatAgo(alertIso(a.datetime))}</span>
					</div>
					<button
						class="x"
						aria-label={`Dismiss: ${alertMessage(a)}`}
						disabled={dismissing[a.uuid]}
						onclick={() => dismiss(a.uuid)}
					>{dismissing[a.uuid] ? '…' : '×'}</button>
				</div>
			{/each}
		</section>
	{/if}

	{#if panel === 'update'}
		<section class="card">
			<h2>System update</h2>
			{#if !newVersion}
				<p class="dim small">
					Up to date{data.system?.version ? ` — running ${data.system.version}` : ''}.
				</p>
			{:else}
			<p class="upd">
				<strong>{newVersion.version}</strong> is available{data.system?.version
					? ` — this box runs ${data.system.version}`
					: ''}.
			</p>
			{#if newVersion.release_notes_url}
				<a class="notes" href={newVersion.release_notes_url} target="_blank" rel="noreferrer noopener">
					Release notes ↗
				</a>
			{/if}
			{/if}
		</section>
	{/if}

	{#if panel === 'jobs'}
		<section class="card">
			<h2>Running now</h2>
			{#if jobs.length === 0}
				<p class="dim small">Nothing running.</p>
			{:else}
			{#each jobs as j (j.id)}
				<div class="job">
					<span class="mono">{j.method}</span>
					<span class="jstate">
						{j.state === 'WAITING' ? 'queued' : `${Math.round(j.progress?.percent ?? 0)}%`}
					</span>
				</div>
			{/each}
			{/if}
		</section>
	{/if}

	{#if pools.length > 0}
		<section class="card">
			<h2>Pools</h2>
			{#each pools as p (p.name)}
				<div class="row">
					{#if p.degraded || p.warning}
						<p class="poolbad">
							<strong>{p.status ?? 'Unhealthy'}</strong>
							{p.degraded
								? 'This pool is not healthy — check Storage for the failing member.'
								: 'This pool is reporting a warning.'}
						</p>
					{/if}
					<Meter
						label={p.name}
						detail={p.total ? `${formatBytes(p.used)} of ${formatBytes(p.total)}` : '—'}
						percent={p.percent}
						tone={p.health}
						note={p.health === 'critical'
							? `${formatPercent(p.percent ?? 0)}% full — ZFS slows down badly this close to full. Free space or add capacity.`
							: p.health === 'warn'
								? `Over ${POOL_WARN_PERCENT}% full — write performance starts to suffer here.`
								: ''}
					/>
					{#if p.status}
						<p class="health" class:bad={p.degraded || anyErrors(p.errors)}>
							<span class="hstat">{p.status}</span>
							{#if p.disks}· {p.disks} disks{/if}
							·
							{#if anyErrors(p.errors)}
								{totalErrors(p.errors)} errors ({p.errors.read}R / {p.errors.write}W / {p.errors.checksum}C)
							{:else}
								no errors
							{/if}
							{#if p.available}· {formatBytes(p.available)} free{/if}
						</p>
					{/if}
					{#if p.layout}
						<p class="layout">
							{p.layout}
							{#if p.mixed}
								<span class="mixed" title="Member disks are not all the same size. RAIDZ sizes each vdev by its smallest member, so the extra capacity on the larger disks is unused.">mixed capacity</span>
							{/if}
							{#if p.groups.cache || p.groups.spare || p.groups.log}
								<span class="dim"
									>· {p.groups.cache} cache · {p.groups.spare} spare{#if p.groups.log}
										· {p.groups.log} log{/if}</span
								>
							{/if}
						</p>
					{/if}
					{#if p.scan && p.scan.state === 'FINISHED' && alertIso(p.scan.end_time)}
						<p class="scrub">
							Last {p.scan.function === 'RESILVER' ? 'resilver' : 'scrub'}
							{formatAgo(alertIso(p.scan.end_time))}
							{#if scanDuration(p.scan) !== null}· took {formatUptime(scanDuration(p.scan) ?? 0)}{/if}
							· <span class:bad={(p.scan.errors ?? 0) > 0}
								>{p.scan.errors ?? 0} error{(p.scan.errors ?? 0) === 1 ? '' : 's'}</span
							>
						</p>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	<section class="card">
		<h2>Live</h2>
		{#if !seenSample}
			<p class="dim small">Waiting for the first sample…</p>
		{:else}
			<div class="row">
				<Meter
					label="CPU"
					detail={`${formatPercent(cpu ?? undefined)}%${
						data.system
							? ` · ${data.system.physical_cores} cores / ${data.system.cores} threads`
							: threadCount
								? ` · ${threadCount} threads`
								: ''
					}${hottest ? ` · ${hottest.temp}°C` : ''}`}
					percent={cpu}
					tone="accent"
					note={busiest || hottest
						? [
								busiest ? `Busiest thread #${busiest.thread} at ${formatPercent(busiest.usage)}%` : '',
								hottest && hottest.count < hottest.total
									? `hottest ${hottest.temp}°C on ${hottest.count} of ${hottest.total}`
									: hottest
										? `all ${hottest.total} threads at ${hottest.temp}°C`
										: ''
							]
								.filter(Boolean)
								.join(' · ')
						: ''}
				/>
			</div>
			<div class="row">
				<Meter
					label="Memory"
					detail={mem ? `${formatBytes(mem.services)} of ${formatBytes(mem.total)}` : '—'}
					percent={memPercent}
					tone="accent"
					note={mem && mem.cache
						? `Excludes ${formatBytes(mem.cache)} of ZFS cache (ARC) — ZFS releases it the moment anything else needs it.`
						: ''}
				/>
			</div>

			{#if mem}
				<div class="metrics trio">
					<div class="metric">
						<span class="k">Free</span>
						<span class="v">{formatBytes(mem.free)}</span>
					</div>
					<div class="metric">
						<span class="k">ZFS cache</span>
						<span class="v">{formatBytes(mem.cache)}</span>
					</div>
					<div class="metric">
						<span class="k">Services</span>
						<span class="v">{formatBytes(mem.services)}</span>
					</div>
				</div>
			{/if}

			<div class="metrics trio">
				<div class="metric">
					<span class="k">Disk read</span>
					<span class="v">{formatRate(live?.disks?.read_bytes)}</span>
				</div>
				<div class="metric">
					<span class="k">Disk write</span>
					<span class="v">{formatRate(live?.disks?.write_bytes)}</span>
				</div>
				<div class="metric">
					<span class="k">Disk busy</span>
					<span class="v">{formatPercent(live?.disks?.busy)}%</span>
				</div>
			</div>
		{/if}
	</section>

	{#if data.system}
		<section class="card">
			<h2>System</h2>
			<dl class="facts">
				<div><dt>Host</dt><dd>{data.system.hostname}</dd></div>
				<div><dt>Version</dt><dd>{data.system.version}</dd></div>
				{#if data.platform}
					<div><dt>Edition</dt><dd>{data.platform.edition}</dd></div>
					<div><dt>Platform</dt><dd>{data.platform.platform}</dd></div>
				{/if}
				<div><dt>Uptime</dt><dd>{formatUptime(data.system.uptime_seconds)}</dd></div>
				<div>
					<dt>Load</dt>
					<dd>{data.system.loadavg.map((n) => n.toFixed(2)).join('  ')}</dd>
				</div>
				<div><dt>CPU</dt><dd class="wrap">{data.system.model}</dd></div>
				<div>
					<dt>Memory</dt>
					<dd>{formatBytes(data.system.physmem)}{data.system.ecc_memory ? ' ECC' : ''}</dd>
				</div>
			</dl>
		</section>
	{/if}

	{#if nics.length > 0}
		<section class="card">
			<h2>Network</h2>
			{#each nics as [name, n] (name)}
				<div class="nic">
					<div class="nicname">
						<span class="mono">{name}</span>
						{#if n.speed}<span class="speed">{n.speed >= 1000 ? `${n.speed / 1000}G` : `${n.speed}M`}</span>{/if}
					</div>
					<div class="rates">
						<span title="Received">↓ {formatRate(n.received_bytes_rate)}</span>
						<span title="Sent">↑ {formatRate(n.sent_bytes_rate)}</span>
					</div>
				</div>
			{/each}
		</section>
	{/if}
{/if}

<Toast bind:message={toastMsg} />

<style>
	.status {
		display: flex;
		gap: 4px;
	}
	.glyph {
		position: relative;
		width: var(--tap);
		min-height: var(--tap);
		display: grid;
		place-items: center;
		border: 0;
		border-radius: var(--r-sm);
		background: transparent;
		color: var(--text-dim);
	}
	.glyph.on {
		background: var(--surface-2);
		color: var(--text);
	}
	.badge {
		position: absolute;
		top: 4px;
		right: 2px;
		min-width: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--info);
		color: #04070f;
		font-size: 10px;
		font-weight: 800;
		line-height: 16px;
		text-align: center;
	}
	.badge.warn {
		background: var(--warn);
	}
	.badge.danger {
		background: var(--danger);
		color: #fff;
	}
	.badge.accent {
		background: var(--accent);
		color: var(--on-accent);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: calc(var(--sa-top) + 14px) 16px 10px;
	}
	h1 {
		margin: 0;
		font-size: 26px;
		letter-spacing: -0.02em;
	}
	.card {
		margin: 12px;
		padding: 14px 16px;
		border-radius: var(--r);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	h2 {
		margin: 0 0 12px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.row + .row {
		margin-top: 14px;
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 16px;
	}
	/*
	 * Both rows below hold three values, so they get three columns rather than a
	 * 2-up grid with a hole in it. The values are short enough ("3.4 GB") to stay
	 * legible at a third of a phone's width.
	 */
	.metrics.trio {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-top: 12px;
	}
	.metrics.trio .metric {
		padding: 8px 10px;
	}
	.metrics.trio .v {
		font-size: 14px;
	}
	.metric {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}
	.k {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	.v {
		font-size: 16px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		border-left: 3px solid var(--info);
		background: var(--surface-2);
	}
	.alert + .alert {
		margin-top: 8px;
	}
	.alert.warn {
		border-left-color: var(--warn);
	}
	.alert.danger {
		border-left-color: var(--danger);
	}
	.atext {
		flex: 1;
		min-width: 0;
	}
	.atext p {
		margin: 0;
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.ameta {
		display: block;
		margin-top: 3px;
		font-size: 11px;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.x {
		flex: none;
		width: 32px;
		min-height: 32px;
		border: 0;
		background: transparent;
		color: var(--text-dim);
		font-size: 20px;
		line-height: 1;
		padding: 0;
	}
	.upd {
		margin: 0 0 8px;
		font-size: 14px;
	}
	.notes {
		display: inline-block;
		margin-top: 4px;
		font-size: 13px;
		color: var(--accent);
	}
	.job {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
	}
	.job + .job {
		border-top: 1px solid var(--border);
	}
	.jstate {
		flex: none;
		font-size: 12px;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.health {
		margin: 6px 0 0;
		font-size: 11px;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.health .hstat {
		color: var(--ok);
		font-weight: 700;
	}
	.health.bad,
	.health.bad .hstat {
		color: var(--danger);
	}
	/*
	 * Layout and scrub sit under the health line as quieter supporting facts:
	 * you read them when you're asking a question, not every time you glance.
	 */
	.layout,
	.scrub {
		margin: 3px 0 0;
		font-size: 11px;
		color: var(--text-faint);
	}
	.layout .dim {
		color: color-mix(in srgb, var(--text-faint) 70%, transparent);
	}
	.mixed {
		margin-left: 4px;
		padding: 1px 5px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--warn) 14%, transparent);
		color: var(--warn);
		cursor: help;
	}
	.scrub .bad {
		color: var(--danger);
		font-weight: 700;
	}
	.poolbad {
		margin: 0 0 8px;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
		font-size: 12px;
		color: var(--text-dim);
	}
	.poolbad strong {
		color: var(--danger);
		display: block;
	}
	.facts {
		margin: 0;
		display: grid;
		gap: 10px;
	}
	.facts > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	dt {
		font-size: 12px;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	dd {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	dd.wrap {
		font-weight: 500;
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	.nic {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
	}
	.nic + .nic {
		border-top: 1px solid var(--border);
	}
	.nicname {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.mono {
		font-family: var(--mono);
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.speed {
		flex: none;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--surface-3);
		color: var(--text-dim);
		font-size: 11px;
		font-weight: 700;
	}
	.rates {
		display: flex;
		gap: 12px;
		flex: none;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
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
		text-transform: none;
		letter-spacing: normal;
		color: var(--text);
	}
	.dim {
		color: var(--text-dim);
	}
	.small {
		font-size: 12px;
	}
</style>
