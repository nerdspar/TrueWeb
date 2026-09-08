<script lang="ts">
	// Bottom sheet for choosing the list sort (§5.1). Lower-half reach (§8).
	type Option = { key: string; label: string; hint: string };

	let {
		open = $bindable(false),
		current = 'state',
		options = [],
		onselect
	}: {
		open?: boolean;
		current?: string;
		options?: Option[];
		onselect?: (key: string) => void;
	} = $props();

	function pick(key: string) {
		open = false;
		onselect?.(key);
	}
</script>

{#if open}
	<div
		class="scrim"
		role="button"
		tabindex="-1"
		aria-label="Close"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	></div>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="Sort apps">
		<div class="grip"></div>
		<h2>Sort by</h2>
		<ul>
			{#each options as o (o.key)}
				<li>
					<button class="opt" class:on={current === o.key} onclick={() => pick(o.key)}>
						<span class="labels">
							<span class="label">{o.label}</span>
							<span class="hint">{o.hint}</span>
						</span>
						<span class="check" aria-hidden="true">{current === o.key ? '✓' : ''}</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 40;
		animation: fade 0.15s ease;
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 41;
		background: var(--surface-2);
		border-top-left-radius: var(--r-lg);
		border-top-right-radius: var(--r-lg);
		border-top: 1px solid var(--border);
		padding: 10px 12px calc(20px + var(--sa-bottom));
		box-shadow: var(--shadow);
		animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.grip {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--surface-3);
		margin: 4px auto 10px;
	}
	h2 {
		margin: 0 0 6px;
		padding: 0 8px;
		font-size: 15px;
		color: var(--text-dim);
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.opt {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 12px;
		border: none;
		background: transparent;
		border-radius: var(--r-sm);
		text-align: left;
	}
	.opt.on {
		background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
	}
	.labels {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.label {
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
	}
	.hint {
		font-size: 12px;
		color: var(--text-faint);
	}
	.check {
		color: var(--accent);
		font-weight: 800;
		font-size: 18px;
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
