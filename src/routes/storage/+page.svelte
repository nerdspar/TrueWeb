<script lang="ts">
	/**
	 * Storage (§5.5). Pool health, not pool administration.
	 *
	 * The design brief here is one sentence from the spec: per-member error
	 * counts must be prominent and must not require drilling in. So the vdev
	 * tree is always expanded, and any non-zero counter is shown on the pool
	 * header too — you should never have to tap to find out a disk is unhappy.
	 */
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import Meter from '$lib/components/Meter.svelte';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import OptionSheet from '$lib/components/OptionSheet.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { formatAgo, formatBytes, formatPercent } from '$lib/client/actions';
	import { alertIso } from '$lib/dashboard/alerts';
	import { poolHealth, poolUsedPercent, type RealtimeUpdate } from '$lib/dashboard/types';
	import {
		anyErrors,
		diskCount,
		flattenTopology,
		poolErrors,
		totalErrors,
		type FlatVdev
	} from '$lib/storage/topology';
	import type { PoolScan } from '$lib/server/storage';

	let { data }: { data: PageData } = $props();

	let toastMsg = $state('');
	/** Live scrub state by pool name, overriding whatever the load returned. */
	let liveScan = $state<Record<string, PoolScan>>({});
	/**
	 * Live *usable* capacity per pool.
	 *
	 * pool.query's size/allocated/free are raw zpool figures — they include
	 * RAIDZ parity, so this pool reads 33 TB raw against 16 TB you can actually
	 * fill. Showing the raw number as "capacity" would both disagree with the
	 * dashboard and understate how full the pool is, which is the one thing this
	 * screen must not get wrong. So usable comes from the realtime feed and raw
	 * is shown separately, labelled.
	 */
	let liveCapacity = $state<NonNullable<RealtimeUpdate['pools']>>({});
	let busyPool = $state<string | null>(null);

	let menuOpen = $state(false);
	let menuPool = $state('');
	let confirmOpen = $state(false);
	let confirmProps = $state({ title: '', message: '', confirmLabel: 'Confirm', danger: false });
	let confirmRun: (() => void) | null = null;

	type Row = {
		pool: (typeof data.pools)[number];
		percent: number | null;
		tone: 'ok' | 'warn' | 'critical';
		/** True when the meter is raw zpool space because usable isn't known yet. */
		raw: boolean;
		used: number | undefined;
		total: number | undefined;
		free: number | undefined;
		members: FlatVdev[];
		errors: ReturnType<typeof poolErrors>;
		disks: number;
		scan: PoolScan | null;
	};

	function describe(pool: (typeof data.pools)[number]): Row {
		const usable = liveCapacity[pool.name];
		const raw = !usable;
		const used = usable?.used ?? pool.allocated ?? undefined;
		const total = usable?.total ?? pool.size ?? undefined;
		const free = usable?.available ?? pool.free ?? undefined;
		const percent = poolUsedPercent({ used, total, available: free });
		return {
			pool,
			percent,
			tone: poolHealth(percent),
			raw,
			used,
			total,
			free,
			members: flattenTopology(pool.topology),
			errors: poolErrors(pool.topology),
			disks: diskCount(pool.topology),
			scan: liveScan[pool.name] ?? pool.scan
		};
	}

	const rows = $derived(data.pools.map(describe));
	const bootRow = $derived(data.boot ? describe(data.boot) : null);
	/** Disks not claimed by any pool — spares and strays worth knowing about. */
	const freeDisks = $derived(data.disks.filter((d) => !d.pool));

	const scanning = (scan: PoolScan | null) =>
		scan?.state === 'SCANNING' || scan?.state === 'PAUSED';

	function askScrub(pool: string, action: 'START' | 'STOP' | 'PAUSE') {
		const verb = action === 'START' ? 'Start' : action === 'STOP' ? 'Stop' : 'Pause';
		confirmProps = {
			title: `${verb} scrub on ${pool}?`,
			message:
				action === 'START'
					? 'A scrub reads and verifies every block in the pool. It runs for hours on a large pool and competes with everything else for disk I/O — but it is how checksum errors get found. Safe to stop partway.'
					: action === 'STOP'
						? 'The scrub stops where it is. Nothing is damaged; the pool simply goes unverified until the next one.'
						: 'The scrub pauses and can be resumed later.',
			confirmLabel: verb,
			danger: false
		};
		confirmRun = () => void scrub(pool, action);
		confirmOpen = true;
	}

	async function scrub(pool: string, action: 'START' | 'STOP' | 'PAUSE') {
		busyPool = pool;
		try {
			const res = await fetch(`/api/pools/${encodeURIComponent(pool)}/scrub`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action })
			});
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			if (!res.ok) throw new Error(body.message ?? 'The scrub request was refused.');
			toastMsg =
				action === 'START'
					? `Scrub started on ${pool}. Progress appears here as it runs.`
					: `Scrub ${action.toLowerCase()}ped on ${pool}.`;
		} catch (err) {
			toastMsg = (err as Error).message ?? 'Could not change the scrub.';
		} finally {
			busyPool = null;
		}
	}

	function openMenu(pool: string) {
		menuPool = pool;
		menuOpen = true;
	}

	const menuOptions = $derived.by(() => {
		const row = rows.find((r) => r.pool.name === menuPool);
		if (row && scanning(row.scan)) {
			return [
				{ key: 'PAUSE', label: 'Pause scrub', hint: 'Resume it later' },
				{ key: 'STOP', label: 'Stop scrub', hint: 'Leaves the pool unverified' }
			];
		}
		return [
			{ key: 'START', label: 'Start scrub', hint: 'Verifies every block — takes hours' }
		];
	});

	onMount(() => {
		if (!data.configured) return;
		// realtime carries usable capacity per pool; scan carries scrub progress.
		const es = new EventSource('/api/stream?scan=1&realtime=1');
		es.addEventListener('realtime', (e) => {
			const payload = JSON.parse((e as MessageEvent).data) as RealtimeUpdate;
			if (payload.pools) liveCapacity = payload.pools;
		});
		es.addEventListener('scan', (e) => {
			const payload = JSON.parse((e as MessageEvent).data) as { name?: string; scan?: PoolScan };
			if (!payload.name || !payload.scan) return;
			liveScan = { ...liveScan, [payload.name]: payload.scan };
		});
		return () => es.close();
	});
</script>

<svelte:head><title>Storage · TrueWeb</title></svelte:head>

<header class="head">
	<h1>Storage</h1>
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else}
	{#each rows as row (row.pool.name)}
		<section class="card">
			<div class="poolhead">
				<div class="poolid">
					<h2>{row.pool.name}</h2>
					<span class="badges">
						<span class="badge" class:bad={!row.pool.healthy}>{row.pool.status}</span>
						{#if anyErrors(row.errors)}
							<span class="badge err">{totalErrors(row.errors)} errors</span>
						{/if}
					</span>
				</div>
				<button
					class="more"
					aria-label={`Scrub actions for ${row.pool.name}`}
					disabled={busyPool === row.pool.name}
					onclick={() => openMenu(row.pool.name)}>···</button
				>
			</div>

			{#if row.pool.status_detail || !row.pool.healthy}
				<p class="detail">{row.pool.status_detail ?? 'This pool is not healthy.'}</p>
			{/if}

			<Meter
				label={row.raw ? 'Capacity (raw)' : 'Capacity'}
				detail={row.total ? `${formatBytes(row.used)} of ${formatBytes(row.total)}` : '—'}
				percent={row.percent}
				tone={row.tone}
				note={row.raw
					? 'Raw pool space, including parity — waiting for usable figures.'
					: ''}
			/>

			<div class="facts">
				<div><dt>Disks</dt><dd>{row.disks}</dd></div>
				<div>
					<dt>Fragmentation</dt>
					<dd>{row.pool.fragmentation !== null ? `${row.pool.fragmentation}%` : '—'}</dd>
				</div>
				<div><dt>Free</dt><dd>{formatBytes(row.free)}</dd></div>
			</div>

			{#if row.scan}
				<div class="scan" class:running={scanning(row.scan)}>
					{#if scanning(row.scan)}
						<strong>{row.scan.function === 'RESILVER' ? 'Resilvering' : 'Scrubbing'}</strong>
						<span>
							{formatPercent(row.scan.percentage)}%{row.scan.total_secs_left
								? ` · about ${Math.round(row.scan.total_secs_left / 3600)}h left`
								: ''}
						</span>
					{:else}
						<strong>Last {row.scan.function === 'RESILVER' ? 'resilver' : 'scrub'}</strong>
						<span>
							{row.scan.state === 'FINISHED' ? 'finished' : (row.scan.state ?? '').toLowerCase()}
							{#if alertIso(row.scan.end_time)}{formatAgo(alertIso(row.scan.end_time))}{/if}
							· {row.scan.errors ?? 0} errors
						</span>
					{/if}
				</div>
			{/if}

			<!-- Always expanded: §5.5 is explicit that error counts must not
			     require drilling in. -->
			<ul class="vdevs">
				{#each row.members as m (m.guid)}
					<li class:member={m.depth > 0} class:bad={!m.healthy || anyErrors(m.errors)}>
						<span class="vname">
							{#if m.depth > 0}<span class="tick" aria-hidden="true">└</span>{/if}
							<span class="mono">{m.label}</span>
							<span class="vtype">{m.type}{m.group !== 'data' ? ` · ${m.group}` : ''}</span>
						</span>
						<span class="vstate">
							{#if anyErrors(m.errors)}
								<span class="counts">
									{#if m.errors.read}<span title="Read errors">R {m.errors.read}</span>{/if}
									{#if m.errors.write}<span title="Write errors">W {m.errors.write}</span>{/if}
									{#if m.errors.checksum}<span title="Checksum errors">C {m.errors.checksum}</span>{/if}
								</span>
							{/if}
							<span class="st" class:okst={m.healthy}>{m.status}</span>
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if bootRow}
		<section class="card">
			<div class="poolhead">
				<div class="poolid">
					<h2>{bootRow.pool.name}</h2>
					<span class="badges">
						<span class="badge" class:bad={!bootRow.pool.healthy}>{bootRow.pool.status}</span>
						{#if anyErrors(bootRow.errors)}
							<span class="badge err">{totalErrors(bootRow.errors)} errors</span>
						{/if}
					</span>
				</div>
			</div>
			<p class="dim small">The boot pool — it holds the OS, not your data.</p>
			<Meter
				label={bootRow.raw ? 'Capacity (raw)' : 'Capacity'}
				detail={bootRow.total
					? `${formatBytes(bootRow.used)} of ${formatBytes(bootRow.total)}`
					: '—'}
				percent={bootRow.percent}
				tone={bootRow.tone}
			/>
		</section>
	{/if}

	{#if data.disks.length > 0}
		<section class="card">
			<h2>Disks</h2>
			<ul class="disks">
				{#each data.disks as d (d.identifier)}
					<li>
						<span class="dname">
							<span class="mono">{d.name}</span>
							<span class="dmodel">{d.model || d.description || d.type}</span>
						</span>
						<span class="dmeta">
							<span>{formatBytes(d.size ?? undefined)}</span>
							<span class="dpool">{d.pool ?? 'unassigned'}</span>
						</span>
					</li>
				{/each}
			</ul>
			{#if freeDisks.length > 0}
				<p class="dim small">
					{freeDisks.length}
					{freeDisks.length === 1 ? 'disk is' : 'disks are'} not part of any pool.
				</p>
			{/if}
		</section>
	{/if}

	{#if Object.keys(data.errors).length > 0}
		<section class="card">
			<h2>Couldn't read everything</h2>
			<ul class="errs">
				{#each Object.entries(data.errors) as [key, message] (key)}
					<li><strong>{key}</strong> — {message}</li>
				{/each}
			</ul>
			<p class="dim small">
				With a scoped API key this is usually a missing role — see DEPLOY.md step 1.
			</p>
		</section>
	{/if}
{/if}

<OptionSheet
	bind:open={menuOpen}
	title={menuPool}
	options={menuOptions}
	onselect={(key) => askScrub(menuPool, key as 'START' | 'STOP' | 'PAUSE')}
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
	.poolhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}
	.poolid {
		min-width: 0;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.badge {
		padding: 2px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ok) 18%, transparent);
		border: 1px solid color-mix(in srgb, var(--ok) 45%, transparent);
		color: var(--ok);
		font-size: 11px;
		font-weight: 700;
	}
	.badge.bad,
	.badge.err {
		background: color-mix(in srgb, var(--danger) 16%, transparent);
		border-color: color-mix(in srgb, var(--danger) 45%, transparent);
		color: var(--danger);
	}
	.more {
		flex: none;
		min-width: 44px;
		min-height: 36px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		letter-spacing: 0.12em;
	}
	.detail {
		margin: 0 0 10px;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent);
		font-size: 12px;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		margin-top: 12px;
	}
	.facts > div {
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}
	dt {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	dd {
		margin: 2px 0 0;
		font-size: 14px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.scan {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-top: 12px;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		font-size: 12px;
		color: var(--text-dim);
	}
	.scan.running {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
	}
	.scan strong {
		color: var(--text);
	}
	.vdevs,
	.disks,
	.errs {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
	}
	.vdevs li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 0;
		border-top: 1px solid var(--border);
	}
	.vdevs li.member {
		padding-left: 10px;
	}
	.vdevs li.bad {
		background: color-mix(in srgb, var(--danger) 8%, transparent);
	}
	.vname {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.tick {
		color: var(--text-faint);
		font-size: 11px;
	}
	.mono {
		font-family: var(--mono);
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vtype {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	.vstate {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.counts {
		display: flex;
		gap: 6px;
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--danger);
	}
	.st {
		font-size: 11px;
		font-weight: 700;
		color: var(--danger);
	}
	.st.okst {
		color: var(--text-faint);
		font-weight: 600;
	}
	.disks li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.dname {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.dmodel {
		font-size: 11px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dmeta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		flex: none;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.dpool {
		font-size: 11px;
		color: var(--text-faint);
	}
	.errs li {
		font-size: 12px;
		color: var(--text-dim);
		padding: 3px 0;
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
		margin: 8px 0 0;
	}
</style>
