<script lang="ts">
	// A bottom sheet that names the target (§6 tier-2 confirmation). Lives in the
	// lower half of the screen for one-handed reach (§8).
	//
	// Pass `confirmName` to raise it to tier 2.5: the name has to be typed before
	// the button does anything. That tier is for actions that are irreversible
	// without looking it — where a tap you half-meant is the whole risk.
	let {
		open = $bindable(false),
		title = 'Are you sure?',
		message = '',
		confirmLabel = 'Confirm',
		danger = false,
		confirmName = '',
		onconfirm
	}: {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		danger?: boolean;
		/** When set, this exact text must be typed to enable the button. */
		confirmName?: string;
		onconfirm?: () => void;
	} = $props();

	let typed = $state('');
	const gated = $derived(Boolean(confirmName));
	const matches = $derived(!gated || typed.trim() === confirmName);

	// Reset on open, so a half-typed name never carries into the next target.
	$effect(() => {
		if (open) typed = '';
	});

	function close() {
		open = false;
	}
	function confirm() {
		if (!matches) return;
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
		{#if gated}
			<label class="typeit" for="confirm-sheet-name">
				Type <code>{confirmName}</code> to confirm
			</label>
			<input
				id="confirm-sheet-name"
				class="text"
				bind:value={typed}
				placeholder={confirmName}
				spellcheck="false"
				autocapitalize="off"
				autocorrect="off"
				autocomplete="off"
			/>
		{/if}
		<div class="actions">
			<button class="btn ghost" onclick={close}>Cancel</button>
			<button class="btn" class:danger disabled={!matches} onclick={confirm}>
				{confirmLabel}
			</button>
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
	.typeit {
		display: block;
		margin: 0 0 6px;
		font-size: 13px;
		color: var(--text-dim);
	}
	code {
		font-family: var(--mono);
		color: var(--text);
	}
	.text {
		width: 100%;
		min-height: 46px;
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font: inherit;
		font-family: var(--mono);
		font-size: 15px;
		padding: 8px 12px;
		margin-bottom: 16px;
	}
	.actions {
		display: flex;
		gap: 10px;
	}
	.btn:disabled {
		background: var(--surface-3);
		color: var(--text-faint);
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
