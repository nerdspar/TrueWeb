<script lang="ts">
	import type { AppState } from '$lib/server/truenas/methods';

	let { state }: { state: AppState | string } = $props();

	// State communicated by color AND shape/label, never color alone (§8): each
	// state gets a distinct glyph as well as a color.
	const meta: Record<string, { cls: string; glyph: string; label: string }> = {
		RUNNING: { cls: 'ok', glyph: '●', label: 'Running' },
		DEPLOYING: { cls: 'info', glyph: '◐', label: 'Deploying' },
		STOPPING: { cls: 'warn', glyph: '◑', label: 'Stopping' },
		STOPPED: { cls: 'idle', glyph: '■', label: 'Stopped' },
		CRASHED: { cls: 'danger', glyph: '▲', label: 'Crashed' }
	};
	const m = $derived(meta[state] ?? { cls: 'idle', glyph: '?', label: String(state) });
</script>

<span class="badge {m.cls}">
	<span class="glyph" aria-hidden="true">{m.glyph}</span>
	{m.label}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.6;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.glyph {
		font-size: 10px;
	}
	.ok {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 14%, transparent);
		border-color: color-mix(in srgb, var(--ok) 34%, transparent);
	}
	.info {
		color: var(--info);
		background: color-mix(in srgb, var(--info) 14%, transparent);
		border-color: color-mix(in srgb, var(--info) 34%, transparent);
	}
	.warn {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 14%, transparent);
		border-color: color-mix(in srgb, var(--warn) 34%, transparent);
	}
	.danger {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 16%, transparent);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
	.idle {
		color: var(--text-dim);
		background: var(--surface-3);
		border-color: var(--border);
	}
</style>
