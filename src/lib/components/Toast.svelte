<script lang="ts">
	// A transient message anchored above the bottom nav. Used for action
	// failures so a rolled-back optimistic action explains itself (§8).
	let { message = $bindable('') }: { message?: string } = $props();

	$effect(() => {
		if (!message) return;
		const t = setTimeout(() => (message = ''), 4500);
		return () => clearTimeout(t);
	});
</script>

{#if message}
	<div class="toast" role="status">
		<span>{message}</span>
		<button aria-label="Dismiss" onclick={() => (message = '')}>×</button>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: calc(var(--nav-h) + var(--sa-bottom) + 12px);
		z-index: 45;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--surface-3);
		border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
		color: var(--text);
		font-size: 14px;
		box-shadow: var(--shadow);
		animation: rise 0.2s ease;
	}
	.toast span {
		flex: 1;
	}
	.toast button {
		border: none;
		background: transparent;
		color: var(--text-dim);
		font-size: 20px;
		line-height: 1;
		min-height: 0;
		padding: 0 4px;
	}
	@keyframes rise {
		from {
			transform: translateY(12px);
			opacity: 0;
		}
	}
</style>
