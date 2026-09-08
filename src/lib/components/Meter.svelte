<script lang="ts">
	/**
	 * A labelled capacity bar. Shared by the dashboard's pool and memory rows and
	 * (later) the storage tab, so "nearly full" looks the same everywhere.
	 *
	 * `tone` is the caller's judgement, not this component's: what counts as too
	 * full depends on what is being measured — 90% of a ZFS pool is a problem,
	 * 90% of RAM on a box with ARC is normal.
	 */
	let {
		label = '',
		detail = '',
		percent = null,
		tone = 'ok',
		note = ''
	}: {
		label?: string;
		/** Right-aligned secondary text, e.g. "15.5 TB of 17.3 TB". */
		detail?: string;
		/** null renders an empty track rather than a zero-width bar. */
		percent?: number | null;
		tone?: 'ok' | 'warn' | 'critical' | 'accent';
		/** Shown under the bar when there is something to say about it. */
		note?: string;
	} = $props();

	const pct = $derived(percent === null ? null : Math.min(100, Math.max(0, percent)));
</script>

<div class="meter">
	<div class="top">
		<span class="label">{label}</span>
		<span class="detail">{detail}</span>
	</div>
	<div
		class="track"
		role="progressbar"
		aria-label={label}
		aria-valuenow={pct ?? undefined}
		aria-valuemin={0}
		aria-valuemax={100}
	>
		{#if pct !== null}
			<div class="fill {tone}" style={`width: ${pct.toFixed(1)}%`}></div>
		{/if}
	</div>
	{#if note}
		<p class="note {tone}">{note}</p>
	{/if}
</div>

<style>
	.meter {
		display: block;
	}
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 6px;
	}
	.label {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detail {
		flex: none;
		font-size: 12px;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.track {
		height: 8px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 999px;
		background: var(--ok);
		/* Realtime samples land about once a second; easing between them reads as
		   a live gauge instead of a stutter. */
		transition: width 0.6s linear;
	}
	.fill.accent {
		background: var(--accent);
	}
	.fill.warn {
		background: var(--warn);
	}
	.fill.critical {
		background: var(--danger);
	}
	.note {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}
	.note.warn {
		color: var(--warn);
	}
	.note.critical {
		color: var(--danger);
	}
</style>
