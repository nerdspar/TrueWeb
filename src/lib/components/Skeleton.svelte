<script lang="ts">
	let { rows = 5 }: { rows?: number } = $props();
</script>

<!-- Skeleton loaders, not spinners, for list views (§8). -->
<div class="skeleton" aria-hidden="true">
	{#each Array(rows) as _, i (i)}
		<div class="row">
			<div class="icon shimmer"></div>
			<div class="lines">
				<div class="line shimmer" style="width: 42%"></div>
				<div class="line shimmer" style="width: 26%"></div>
			</div>
		</div>
	{/each}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
	}
	.icon {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		flex: none;
	}
	.lines {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.line {
		height: 12px;
		border-radius: 6px;
	}
	.shimmer {
		background: linear-gradient(
			100deg,
			var(--surface-2) 30%,
			var(--surface-3) 50%,
			var(--surface-2) 70%
		);
		background-size: 200% 100%;
		animation: shimmer 1.3s ease-in-out infinite;
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
</style>
