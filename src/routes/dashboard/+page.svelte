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
	import Meter from '$lib/components/Meter.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { formatAgo, formatBytes, formatPercent, formatRate, formatUptime } from '$lib/client/actions';
	import { alertIso, alertMessage, alertTone, sortAlerts } from '$lib/dashboard/alerts';
	import { anyErrors, diskCount, poolErrors, totalErrors } from '$lib/storage/topology';
	import {
		aggregateCpu,
		memoryUsed,
		peakCpuTemp,
		poolHealth,
		poolUsedPercent,
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
	const cpuTemp = $derived(peakCpuTemp(live?.cpu));
	const coreCount = $derived(Object.keys(live?.cpu ?? {}).filter((k) => /^cpu\d+$/.test(k)).length);
	const memTotal = $derived(live?.memory?.physical_memory_total ?? null);
	const memUsed = $derived(memoryUsed(live?.memory));
	const memPercent = $derived(
		memUsed !== null && memTotal ? (memUsed / memTotal) * 100 : null
	);

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
					scan: entry?.scan ?? null
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
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else}
	{#if alerts.length > 0}
		<section class="card">
			<h2>Alerts</h2>
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

	{#if newVersion}
		<section class="card">
			<h2>System update</h2>
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
		</section>
	{/if}

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
					detail={`${formatPercent(cpu ?? undefined)}%${coreCount ? ` · ${coreCount} threads` : ''}${cpuTemp !== null ? ` · ${cpuTemp}°C` : ''}`}
					percent={cpu}
					tone="accent"
				/>
			</div>
			<div class="row">
				<Meter
					label="Memory"
					detail={memUsed !== null && memTotal
						? `${formatBytes(memUsed)} of ${formatBytes(memTotal)}`
						: '—'}
					percent={memPercent}
					tone="accent"
					note={live?.memory?.arc_size
						? `Includes ${formatBytes(live.memory.arc_size)} of ZFS cache (ARC), which is reclaimable.`
						: ''}
				/>
			</div>

			<div class="metrics">
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
				<div class="metric">
					<span class="k">ZFS cache</span>
					<span class="v">{formatBytes(live?.memory?.arc_size)}</span>
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
