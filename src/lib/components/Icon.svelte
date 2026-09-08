<script lang="ts">
	/**
	 * The app's icons. Inline SVG rather than an icon font or a dependency: they
	 * inherit currentColor so an active state needs no second asset, and there's
	 * nothing to fetch on a phone.
	 *
	 * Drawn on a 24-unit grid with round joins, so they sit together at any size.
	 */
	export type IconName =
		| 'dashboard'
		| 'storage'
		| 'datasets'
		| 'apps'
		| 'bell'
		| 'update'
		| 'activity';

	let { name, size = 22 }: { name: IconName; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'dashboard'}
		<!-- A gauge: the "how is it doing right now" glyph. -->
		<path d="M3.5 16a8.5 8.5 0 0 1 17 0" />
		<path d="M12 16l4.2-4.6" />
		<circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
	{:else if name === 'storage'}
		<!-- Stacked disks. -->
		<ellipse cx="12" cy="5.8" rx="7.6" ry="2.8" />
		<path d="M4.4 5.8v5.4c0 1.55 3.4 2.8 7.6 2.8s7.6-1.25 7.6-2.8V5.8" />
		<path d="M4.4 11.2v5.4c0 1.55 3.4 2.8 7.6 2.8s7.6-1.25 7.6-2.8v-5.4" />
	{:else if name === 'datasets'}
		<!-- A folder, for a browsable tree. -->
		<path
			d="M3.2 7.4a1.8 1.8 0 0 1 1.8-1.8h3.4a1.8 1.8 0 0 1 1.28.53l1.24 1.27h7.06a1.8 1.8 0 0 1 1.8 1.8v7.6a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8z"
		/>
	{:else if name === 'bell'}
		<!-- Alerts. -->
		<path d="M18 8.6a6 6 0 1 0-12 0c0 5.1-2.1 6.6-2.1 6.6h16.2S18 13.7 18 8.6" />
		<path d="M13.7 19a2 2 0 0 1-3.4 0" />
	{:else if name === 'update'}
		<!-- An available update: into the box, not out of it. -->
		<path d="M12 3.5v10.5" />
		<path d="M7.8 9.8L12 14l4.2-4.2" />
		<path d="M4.5 16.5v2A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 2-2v-2" />
	{:else if name === 'activity'}
		<!-- Work in progress. -->
		<path d="M3.5 12h3.2l2.1-5.4 3.4 10.8 2.3-5.4h5" />
	{:else}
		<!-- Four tiles, for apps. -->
		<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="2" />
		<rect x="13.4" y="3.4" width="7.2" height="7.2" rx="2" />
		<rect x="3.4" y="13.4" width="7.2" height="7.2" rx="2" />
		<rect x="13.4" y="13.4" width="7.2" height="7.2" rx="2" />
	{/if}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
