<script lang="ts">
	/**
	 * Why a job failed, stated persistently rather than in a toast that vanishes
	 * before it can be read.
	 *
	 * TrueNAS records app lifecycle failures as a one-line error pointing at
	 * /var/log/app_lifecycle.log, and leaves the job's own logs_path and
	 * logs_excerpt null. That file is only retrievable through the HTTP download
	 * endpoint, which this project deliberately doesn't use (§3.1) — so when the
	 * error names it, say so plainly and give the usual causes instead of
	 * pretending to have detail we can't get.
	 */
	import { extractBoundPort, nextFreePort } from '$lib/compose/edit';

	let {
		error = '',
		exception = '',
		logsExcerpt = '',
		app = '',
		title = 'It failed',
		onretry,
		ondismiss,
		suggestPort,
		onchangeport
	}: {
		error?: string | null;
		exception?: string | null;
		logsExcerpt?: string | null;
		/** App name, to narrow the lifecycle log to the relevant lines. */
		app?: string;
		title?: string;
		onretry?: () => void;
		ondismiss?: () => void;
		/** A free port to offer, when the failure names a clashing one. */
		suggestPort?: (from: number) => number;
		/** Apply a new host port. Offered only when a clash was detected. */
		onchangeport?: (from: number, to: number) => void;
	} = $props();

	/** The middleware prefixes its errors, e.g. "[EFAULT] …". */
	const clean = $derived((error ?? '').replace(/^\[\w+\]\s*/, '').trim());
	const lifecycleLog = $derived(/app_lifecycle\.log/.test(clean));
	let showTrace = $state(false);

	type Lifecycle = {
		available: boolean;
		path: string;
		lines: string[];
		filtered: boolean;
		reason?: string;
	};
	let lifecycle = $state<Lifecycle | null>(null);
	let loadingLog = $state(false);

	/**
	 * A port clash is the one failure pre-flight structurally cannot catch:
	 * app.used_ports only sees ports held by apps, and v25.10 has no
	 * system-wide port method. The reason is in the log, so read it from there.
	 */
	const clashPort = $derived(
		extractBoundPort([clean, exception ?? '', ...(lifecycle?.lines ?? [])].join('\n'))
	);

	/**
	 * The replacement port lives here rather than in the parent: the fix belongs
	 * beside the sentence explaining the problem. Rendering it further down the
	 * page meant tapping the button appeared to do nothing, because the panel
	 * (with a log tail in it) is taller than the screen.
	 *
	 * Seed once per clash, tracked by a plain variable so it isn't reactive.
	 * Keying the seed off an empty field instead ("fill it if blank") re-fills
	 * it the instant you backspace the last digit, which makes the suggestion
	 * impossible to delete and forces you to select-all to type over it.
	 */
	let newPort = $state('');
	let seededFor: number | null = null;
	$effect(() => {
		if (clashPort === null || seededFor === clashPort) return;
		seededFor = clashPort;
		newPort = String(suggestPort?.(clashPort) ?? nextFreePort(clashPort));
	});

	/**
	 * A port that can't be applied disables the button, rather than leaving it
	 * live and silently doing nothing — the same failure mode as the fixer being
	 * off-screen. An empty field is mid-edit, not an error, so it says nothing.
	 */
	const target = $derived(/^\d+$/.test(newPort.trim()) ? Number(newPort.trim()) : null);
	const portOk = $derived(
		target !== null && target >= 1 && target <= 65535 && target !== clashPort
	);

	function applyPort() {
		if (clashPort === null || !portOk || target === null) return;
		onchangeport?.(clashPort, target);
	}

	// When the error points at the lifecycle log, go and get it.
	$effect(() => {
		if (!lifecycleLog || lifecycle || loadingLog) return;
		loadingLog = true;
		const qs = app ? `?app=${encodeURIComponent(app)}&lines=200` : '?lines=200';
		fetch(`/api/logs/lifecycle${qs}`)
			.then((r) => r.json())
			.then((d: Lifecycle) => (lifecycle = d))
			.catch(() => (lifecycle = { available: false, path: '', lines: [], filtered: false }))
			.finally(() => (loadingLog = false));
	});
</script>

<section class="panel" role="alert">
	<div class="head">
		<h2>{title}</h2>
		{#if ondismiss}
			<button class="x" aria-label="Dismiss" onclick={ondismiss}>×</button>
		{/if}
	</div>

	{#if clean}
		<p class="msg">{clean}</p>
	{/if}

	{#if clashPort}
		<div class="clash">
			<p>
				<strong>Port {clashPort} is already taken on the host.</strong>
				Pre-flight only sees ports used by other apps — TrueNAS has no way to report a port held by
				anything else, so this one only shows up here.
			</p>
			{#if onchangeport}
				<div class="fix">
					<code>{clashPort}</code>
					<span aria-hidden="true">→</span>
					<input
						class="port"
						bind:value={newPort}
						inputmode="numeric"
						aria-label={`New host port to replace ${clashPort}`}
					/>
					<button class="tiny go" onclick={applyPort} disabled={!portOk}>Change</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if lifecycleLog}
		{#if loadingLog}
			<p class="dim small">Reading the lifecycle log…</p>
		{:else if lifecycle?.available && lifecycle.lines.length > 0}
			<p class="dim small">
				From <code>{lifecycle.path}</code>{lifecycle.filtered ? ` — lines mentioning ${app}` : ' — tail'}
			</p>
			<pre>{lifecycle.lines.join('\n')}</pre>
		{:else}
			<div class="hint">
				<p>
					The detail is in <code>{lifecycle?.path || '/var/log/app_lifecycle.log'}</code> on the
					TrueNAS host. {lifecycle?.reason ?? ''}
				</p>
				<p>
					To read it here, bind-mount it read-only into TrueWeb and restart:
				</p>
				<pre class="snippet">volumes:
  - /var/log/app_lifecycle.log:/var/log/app_lifecycle.log:ro</pre>
				<p class="usual">Meanwhile, it's nearly always one of:</p>
				<ul>
					<li>
						a mounted path the container can't write — set its owner (568:568 is the apps account)
					</li>
					<li>a published port taken by something that isn't an app, so pre-flight can't see it</li>
					<li>an image that can't be pulled — a private registry, or a tag that doesn't exist</li>
				</ul>
			</div>
		{/if}
	{/if}

	{#if logsExcerpt}
		<pre>{logsExcerpt}</pre>
	{/if}

	{#if exception}
		<button class="link" onclick={() => (showTrace = !showTrace)}>
			{showTrace ? 'Hide' : 'Show'} technical detail
		</button>
		{#if showTrace}<pre class="trace">{exception}</pre>{/if}
	{/if}

	{#if onretry}
		<button class="retry" onclick={onretry}>Try again</button>
	{/if}
</section>

<style>
	.panel {
		margin: 12px;
		padding: 14px 16px;
		border-radius: var(--r);
		background: color-mix(in srgb, var(--danger) 9%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--danger) 42%, transparent);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	h2 {
		margin: 0;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--danger);
	}
	.x {
		border: 0;
		background: transparent;
		color: var(--text-dim);
		font-size: 22px;
		line-height: 1;
		min-height: 0;
		padding: 0 4px;
	}
	.msg {
		margin: 8px 0 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}
	.hint {
		margin-top: 10px;
		font-size: 13px;
		color: var(--text-dim);
	}
	.hint p {
		margin: 0 0 6px;
	}
	.usual {
		color: var(--text);
		font-weight: 600;
	}
	.hint ul {
		margin: 0;
		padding-left: 18px;
	}
	.hint li {
		margin-bottom: 3px;
	}
	code {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text);
	}
	pre {
		margin: 10px 0 0;
		max-height: 32vh;
		overflow: auto;
		background: #04050a;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 10px;
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.5;
		color: #cfd6e6;
		white-space: pre;
		-webkit-overflow-scrolling: touch;
	}
	.trace {
		font-size: 10px;
	}
	.clash {
		margin-top: 10px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 38%, transparent);
		font-size: 13px;
	}
	.clash p {
		margin: 0;
	}
	.fix {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}
	.fix code {
		flex: none;
		color: var(--danger);
	}
	.fix .port {
		width: 96px;
		min-height: 40px;
		text-align: center;
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font-family: var(--mono);
		font-size: 15px;
		padding: 6px 8px;
	}
	.fix .tiny {
		margin-top: 0;
	}
	.tiny {
		margin-top: 10px;
		min-height: 40px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
	}
	.tiny.go {
		border-color: transparent;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.tiny.go:disabled {
		background: var(--surface-2);
		border-color: var(--border);
		color: var(--text-dim);
	}
	.snippet {
		max-height: none;
		color: #9fd0ff;
	}
	.dim {
		color: var(--text-dim);
		margin: 10px 0 0;
	}
	.small {
		font-size: 12px;
	}
	.link {
		margin-top: 10px;
		border: 0;
		background: transparent;
		color: var(--accent);
		font-size: 13px;
		min-height: 32px;
		padding: 0;
	}
	.retry {
		margin-top: 12px;
		width: 100%;
		min-height: 46px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
	}
</style>
