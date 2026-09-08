<script lang="ts">
	// A bottom sheet that names the target (§6 tier-2 confirmation). Lives in the
	// lower half of the screen for one-handed reach (§8).
	let {
		open = $bindable(false),
		title = 'Are you sure?',
		message = '',
		confirmLabel = 'Confirm',
		danger = false,
		onconfirm
	}: {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		danger?: boolean;
		onconfirm?: () => void;
	} = $props();

	function close() {
		open = false;
	}
	function confirm() {
		open = false;
		onconfirm?.();
	}
</script>

{#if open}
	<div
		class="scrim"
		role="button"
		tabindex="-1"
		aria-label="Cancel"
		onclick={close}
		onkeydown={(e) => e.key === 'Escape' && close()}
	></div>
	<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
		<div class="grip"></div>
		<h2>{title}</h2>
		{#if message}<p>{message}</p>{/if}
		<div class="actions">
			<button class="btn ghost" onclick={close}>Cancel</button>
			<button class="btn" class:danger onclick={confirm}>{confirmLabel}</button>
		</div>
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
		padding: 10px 20px calc(24px + var(--sa-bottom));
		box-shadow: var(--shadow);
		animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.grip {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--surface-3);
		margin: 4px auto 14px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 19px;
	}
	p {
		margin: 0 0 18px;
		color: var(--text-dim);
		/* Upgrade summaries arrive as a version line plus changelog excerpt. */
		white-space: pre-wrap;
		max-height: 40dvh;
		overflow-y: auto;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 10px;
	}
	.btn {
		flex: 1;
		min-height: 48px;
		border: none;
		border-radius: var(--r);
		font-weight: 700;
		font-size: 15px;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.btn.ghost {
		background: var(--surface-3);
		color: var(--text);
	}
	.btn.danger {
		background: var(--danger);
		color: #fff;
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
