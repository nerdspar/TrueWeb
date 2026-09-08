<script lang="ts">
	/**
	 * One dataset (§5.6). Read-mostly: properties, space, ownership.
	 *
	 * Ownership is given its own card rather than buried in a property list,
	 * because §5.6 says plainly that getting it wrong is the most common reason
	 * a freshly deployed container fails. Fixing it is offered here, since
	 * finding out and then having to go elsewhere to act is the annoying half.
	 *
	 * Not in v1, per §5.6: deleting datasets, renaming, promoting clones, ACL
	 * editing. "Dataset deletion from a phone is a foot-gun with no upside."
	 */
	import type { PageData } from './$types';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { hasQuota, propNumber, propText } from '$lib/datasets/props';

	let { data }: { data: PageData } = $props();

	/** The apps account (§5.2) — the answer nine times out of ten. */
	const DEFAULT_UID = 568;
	const DEFAULT_GID = 568;

	let toastMsg = $state('');
	let uid = $state('');
	let gid = $state('');
	let recursive = $state(false);
	let chowning = $state(false);
	let confirmOpen = $state(false);
	let editingOwner = $state(false);

	const ds = $derived(data.dataset);
	const parent = $derived(data.name.split('/').slice(0, -1).join('/'));

	const used = $derived(propNumber(ds?.used));
	const available = $derived(propNumber(ds?.available));
	const capacityPercent = $derived(
		used !== null && available !== null && used + available > 0
			? (used / (used + available)) * 100
			: null
	);

	/** A quota changes what "full" means, so it drives the meter when set. */
	const quotaBytes = $derived(hasQuota(ds?.quota) ? propNumber(ds?.quota) : null);
	const quotaPercent = $derived(
		quotaBytes && used !== null ? Math.min(100, (used / quotaBytes) * 100) : null
	);

	/** Unix mode as rwxr-xr-x, from the octal filesystem.stat gives. */
	const modeText = $derived.by(() => {
		const mode = data.stat?.mode;
		if (typeof mode !== 'number') return '';
		const bits = mode & 0o777;
		const rwx = (n: number) =>
			`${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
		const octal = bits.toString(8).padStart(3, '0');
		return `${rwx((bits >> 6) & 7)}${rwx((bits >> 3) & 7)}${rwx(bits & 7)} (${octal})`;
	});

	const ownerIsApps = $derived(data.stat?.uid === DEFAULT_UID && data.stat?.gid === DEFAULT_GID);

	function startEdit() {
		uid = String(data.stat?.uid ?? DEFAULT_UID);
		gid = String(data.stat?.gid ?? DEFAULT_GID);
		recursive = false;
		editingOwner = true;
	}

	function askChown() {
		const u = Number(uid);
		const g = Number(gid);
		if (!Number.isInteger(u) || !Number.isInteger(g) || u < 0 || g < 0) {
			toastMsg = 'UID and GID must be whole numbers.';
			return;
		}
		confirmOpen = true;
	}

	async function chown() {
		if (!ds?.mountpoint) return;
		chowning = true;
		try {
			const res = await fetch('/api/paths/chown', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					path: ds.mountpoint,
					uid: Number(uid),
					gid: Number(gid),
					recursive
				})
			});
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			if (!res.ok) throw new Error(body.message ?? 'The change was refused.');
			toastMsg = `Ownership set to ${uid}:${gid}${recursive ? ' recursively' : ''}. Reload to confirm.`;
			editingOwner = false;
		} catch (err) {
			toastMsg = (err as Error).message ?? 'Could not change ownership.';
		} finally {
			chowning = false;
		}
	}

	type Fact = { label: string; value: string };
	const properties = $derived.by<Fact[]>(() => {
		if (!ds) return [];
		const rows: Fact[] = [
			{ label: 'Type', value: ds.type ?? '' },
			{ label: 'Compression', value: propText(ds.compression) },
			{ label: 'Compression ratio', value: propText(ds.compressratio) },
			{ label: 'Record size', value: propText(ds.recordsize) },
			{ label: 'Quota', value: hasQuota(ds.quota) ? propText(ds.quota) : 'none' },
			{ label: 'Ref quota', value: hasQuota(ds.refquota) ? propText(ds.refquota) : 'none' },
			{ label: 'Used by snapshots', value: propText(ds.usedbysnapshots) },
			{ label: 'Used by children', value: propText(ds.usedbychildren) },
			{ label: 'Used by this dataset', value: propText(ds.usedbydataset) },
			{ label: 'Access time', value: propText(ds.atime) },
			{ label: 'Read only', value: propText(ds.readonly) },
			{ label: 'Deduplication', value: propText(ds.deduplication) },
			{ label: 'Sync', value: propText(ds.sync) },
			{ label: 'ACL type', value: propText(ds.acltype) }
		];
		if (ds.encrypted) {
			rows.push({ label: 'Encryption', value: propText(ds.encryption_algorithm) || 'yes' });
			rows.push({ label: 'Encryption root', value: ds.encryption_root ?? '' });
		}
		// A property the middleware didn't send is not a property worth a blank row.
		return rows.filter((r) => r.value !== '');
	});
</script>

<svelte:head><title>{data.name} · TrueWeb</title></svelte:head>

<header class="head">
	<a class="back" href={parent ? `/datasets` : '/datasets'} aria-label="Back to datasets">←</a>
	<div class="title">
		<h1>{data.name.split('/').pop()}</h1>
		<div class="sub">{data.name}</div>
	</div>
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else if !ds}
	<div class="empty">
		<div class="icon">🔍</div>
		<h2>Dataset not found</h2>
		<p class="dim">Nothing is named <code>{data.name}</code>.</p>
		<p><a href="/datasets">Back to datasets</a></p>
	</div>
{:else}
	{#if ds.locked}
		<section class="card locked">
			<h2>Locked</h2>
			<p>
				This dataset is encrypted and locked, so its contents and mountpoint aren't available.
				Unlock it from the TrueNAS UI.
			</p>
		</section>
	{/if}

	<section class="card">
		<h2>Space</h2>
		{#if quotaBytes}
			<Meter
				label="Against quota"
				detail={`${propText(ds.used)} of ${propText(ds.quota)}`}
				percent={quotaPercent}
				tone={quotaPercent !== null && quotaPercent >= 90
					? 'critical'
					: quotaPercent !== null && quotaPercent >= 80
						? 'warn'
						: 'accent'}
			/>
		{:else}
			<Meter
				label="Used"
				detail={`${propText(ds.used)}${available !== null ? ` · ${propText(ds.available)} free` : ''}`}
				percent={capacityPercent}
				tone="accent"
				note="Free space is shared with the rest of the pool — there's no quota on this dataset."
			/>
		{/if}
	</section>

	{#if ds.mountpoint}
		<section class="card">
			<div class="cardhead">
				<h2>Ownership</h2>
				{#if !editingOwner && !ds.locked}
					<button class="tiny" onclick={startEdit}>Change</button>
				{/if}
			</div>
			{#if data.stat}
				<dl class="facts">
					<div><dt>Owner</dt><dd>{data.stat.uid}:{data.stat.gid}</dd></div>
					<div><dt>Mode</dt><dd class="mono">{modeText}</dd></div>
					<div><dt>Mountpoint</dt><dd class="mono wrap">{ds.mountpoint}</dd></div>
				</dl>
				{#if !ownerIsApps}
					<p class="hint">
						The TrueNAS apps account is <code>568:568</code>. A container that can't write to a
						mounted path is nearly always this.
					</p>
				{/if}
			{:else}
				<p class="dim small">Couldn't read ownership for this path.</p>
			{/if}

			{#if editingOwner}
				<div class="owner">
					<label>
						<span>UID</span>
						<input bind:value={uid} inputmode="numeric" />
					</label>
					<label>
						<span>GID</span>
						<input bind:value={gid} inputmode="numeric" />
					</label>
					<button class="preset" onclick={() => { uid = String(DEFAULT_UID); gid = String(DEFAULT_GID); }}>
						Use 568:568
					</button>
					<label class="check">
						<input type="checkbox" bind:checked={recursive} />
						<span>Apply to everything inside as well</span>
					</label>
					<div class="ownerActions">
						<button class="ghost" onclick={() => (editingOwner = false)}>Cancel</button>
						<button class="go" disabled={chowning} onclick={askChown}>
							{chowning ? 'Applying…' : 'Apply'}
						</button>
					</div>
				</div>
			{/if}
		</section>
	{/if}

	<section class="card">
		<h2>Properties</h2>
		<dl class="facts">
			{#each properties as f (f.label)}
				<div><dt>{f.label}</dt><dd>{f.value}</dd></div>
			{/each}
		</dl>
	</section>
{/if}

<ConfirmSheet
	bind:open={confirmOpen}
	title={`Set owner to ${uid}:${gid}?`}
	message={recursive
		? `This changes the owner of ${ds?.mountpoint ?? 'this path'} and everything inside it. On a large dataset that touches a lot of files and cannot be undone in one step.`
		: `This changes the owner of ${ds?.mountpoint ?? 'this path'} itself. Files already inside keep their current owner.`}
	confirmLabel="Set owner"
	danger={recursive}
	onconfirm={() => void chown()}
/>
<Toast bind:message={toastMsg} />

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(var(--sa-top) + 12px) 16px 12px;
	}
	.back {
		flex: none;
		width: 40px;
		min-height: 40px;
		display: grid;
		place-items: center;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		color: var(--text);
		text-decoration: none;
		font-size: 18px;
	}
	.title {
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
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
	}
	.card {
		margin: 12px;
		padding: 14px 16px;
		border-radius: var(--r);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.card.locked {
		background: color-mix(in srgb, var(--warn) 10%, var(--surface));
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.card.locked p {
		margin: 0;
		font-size: 13px;
		color: var(--text-dim);
	}
	.cardhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}
	h2 {
		margin: 0 0 12px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.cardhead h2 {
		margin: 0;
	}
	.tiny {
		min-height: 34px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
	}
	.facts {
		margin: 0;
		display: grid;
		gap: 9px;
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
	}
	dd {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.mono {
		font-family: var(--mono);
		font-weight: 500;
	}
	.wrap {
		overflow-wrap: anywhere;
		text-align: right;
	}
	.hint {
		margin: 12px 0 0;
		font-size: 12px;
		color: var(--warn);
	}
	code {
		font-family: var(--mono);
		font-size: 12px;
	}
	.owner {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		display: grid;
		gap: 10px;
	}
	.owner label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		color: var(--text-dim);
	}
	.owner input:not([type='checkbox']) {
		width: 120px;
		min-height: 42px;
		text-align: center;
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font-family: var(--mono);
		font-size: 15px;
	}
	.preset {
		min-height: 38px;
		border-radius: var(--r-sm);
		border: 1px dashed var(--border);
		background: transparent;
		color: var(--accent);
		font-size: 13px;
	}
	.check {
		justify-content: flex-start;
		gap: 10px;
	}
	.check input {
		width: 22px;
		height: 22px;
		accent-color: var(--accent);
	}
	.ownerActions {
		display: flex;
		gap: 10px;
	}
	.ownerActions button {
		flex: 1;
		min-height: 44px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
	}
	.ownerActions .go {
		border-color: transparent;
		background: var(--accent-grad);
		color: var(--on-accent);
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
