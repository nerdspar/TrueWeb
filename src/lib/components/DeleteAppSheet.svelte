<script lang="ts">
	/**
	 * Deleting an app: tier 2.5 (§6) — irreversible and not obviously so, so it
	 * requires typing the name, the same bar as convert_to_custom.
	 *
	 * Stored data is a separate, off-by-default choice. Removing an app and
	 * removing the data it spent a year accumulating are not the same decision,
	 * and a container that won't start is recoverable in a way a deleted dataset
	 * is not (§5.6 makes the same argument).
	 */
	let {
		open = $bindable(false),
		name = '',
		isCustom = false,
		ondelete
	}: {
		open?: boolean;
		name?: string;
		isCustom?: boolean;
		ondelete?: (opts: { removeImages: boolean; removeData: boolean; force: boolean }) => void;
	} = $props();

	let typed = $state('');
	let removeImages = $state(true);
	let removeData = $state(false);

	const matches = $derived(typed.trim() === name);

	// Reset every time it opens: a half-typed name or a left-over "delete data"
	// tick must never carry into the next app.
	$effect(() => {
		if (open) {
			typed = '';
			removeImages = true;
			removeData = false;
		}
	});

	function confirm() {
		if (!matches) return;
		open = false;
		// Custom apps are refused without the force flag, since the middleware
		// treats their config as worth protecting. Typing the name is the consent.
		ondelete?.({ removeImages, removeData, force: isCustom });
	}
</script>

{#if open}
	<div
		class="scrim"
		role="button"
		tabindex="-1"
		aria-label="Cancel"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-label={`Delete ${name}`}>
		<div class="grip"></div>
		<h2>Delete {name}?</h2>
		<p class="lead">
			The app and its containers are removed. This can't be undone — there's no rollback for a
			deleted app.
		</p>

		<label class="opt">
			<input type="checkbox" bind:checked={removeImages} />
			<span>
				<strong>Remove its images</strong>
				<em>Frees disk space. They'd be pulled again on a reinstall.</em>
			</span>
		</label>

		<label class="opt danger" class:on={removeData}>
			<input type="checkbox" bind:checked={removeData} />
			<span>
				<strong>Also delete its stored data</strong>
				<em>
					Destroys the app's TrueNAS-managed volumes and everything in them. Leave this off unless
					you mean it. Host paths you mounted yourself are not touched either way.
				</em>
			</span>
		</label>

		<label class="typeit" for="confirm-name">
			Type <code>{name}</code> to confirm
		</label>
		<input
			id="confirm-name"
			class="text"
			bind:value={typed}
			placeholder={name}
			spellcheck="false"
			autocapitalize="off"
			autocorrect="off"
			autocomplete="off"
		/>

		<div class="actions">
			<button class="btn ghost" onclick={() => (open = false)}>Cancel</button>
			<button class="btn kill" disabled={!matches} onclick={confirm}>
				{removeData ? 'Delete app and data' : 'Delete app'}
			</button>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 50;
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 51;
		max-height: 92dvh;
		overflow-y: auto;
		background: var(--surface-2);
		border-top-left-radius: var(--r-lg);
		border-top-right-radius: var(--r-lg);
		border-top: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
		padding: 10px 20px calc(20px + var(--sa-bottom));
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
	.lead {
		margin: 0 0 14px;
		color: var(--text-dim);
		font-size: 14px;
	}
	.opt {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 12px;
		margin-bottom: 8px;
		border-radius: var(--r-sm);
		background: var(--surface-3);
		border: 1px solid transparent;
	}
	.opt input {
		width: 22px;
		height: 22px;
		flex: none;
		margin-top: 1px;
		accent-color: var(--accent);
	}
	.opt strong {
		display: block;
		font-size: 14px;
	}
	.opt em {
		display: block;
		margin-top: 2px;
		font-style: normal;
		font-size: 12px;
		color: var(--text-faint);
	}
	.opt.danger input {
		accent-color: var(--danger);
	}
	.opt.danger.on {
		border-color: color-mix(in srgb, var(--danger) 55%, transparent);
		background: color-mix(in srgb, var(--danger) 12%, var(--surface-3));
	}
	.opt.danger.on em {
		color: var(--danger);
	}
	.typeit {
		display: block;
		margin: 14px 0 6px;
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
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-top: 16px;
	}
	.btn {
		flex: 1;
		min-height: 48px;
		border: none;
		border-radius: var(--r);
		font-weight: 700;
		font-size: 15px;
		background: var(--surface-3);
		color: var(--text);
	}
	.btn.kill {
		background: var(--danger);
		color: #fff;
	}
	.btn.kill:disabled {
		opacity: 0.4;
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}
</style>
