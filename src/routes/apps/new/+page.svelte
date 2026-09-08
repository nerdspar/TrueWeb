<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import ComposeEditor from '$lib/components/ComposeEditor.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { sanitizeCompose } from '$lib/compose/sanitize';
	import {
		inspectCompose,
		findPlaceholders,
		substitutePlaceholders,
		validateAppName
	} from '$lib/compose/inspect';
	import { repoNameFromUrl, suggestAppName } from '$lib/compose/github';
	import { replaceVolumeSource, replaceHostPort, nextFreePort } from '$lib/compose/edit';
	import PathPicker from '$lib/components/PathPicker.svelte';
	import JobFailure from '$lib/components/JobFailure.svelte';
	import type { PathReport, PreflightResult } from '$lib/compose/types';

	let { data }: { data: PageData } = $props();

	const DRAFT_KEY = 'trueweb.compose-draft';
	/** The apps account (§5.2), used unless the compose says otherwise. */
	const DEFAULT_UID = 568;
	const DEFAULT_GID = 568;

	let name = $state('');
	let compose = $state('');
	let url = $state('');
	let fetching = $state(false);
	let notes = $state<string[]>([]);
	let varValues = $state<Record<string, string>>({});
	let toastMsg = $state('');

	let pre = $state<PreflightResult | null>(null);
	let checking = $state(false);
	/** Paths we've created this session, so the checklist can tick them off. */
	let provisioned = $state<Record<string, string>>({});
	let working = $state<Record<string, boolean>>({});
	/** Chosen kind per path, defaulting to the pre-flight recommendation. */
	let kinds = $state<Record<string, 'dataset' | 'directory'>>({});

	let uid = $state(String(DEFAULT_UID));
	let gid = $state(String(DEFAULT_GID));

	/** Path picker: which bind mount we're re-pointing, if any. */
	let pickerOpen = $state(false);
	let pickerFor = $state<string>('');
	let pickerStart = $state('/mnt');
	/** Working values for the port-conflict fixers. */
	let portEdits = $state<Record<number, string>>({});

	let deploying = $state(false);
	let deployPct = $state<number | undefined>(undefined);
	let deployNote = $state('');
	let deployJob: number | null = null;
	/** A failed deploy stays on screen until dismissed — see JobFailure. */
	let failure = $state<{ error: string; exception: string } | null>(null);

	/** Placeholders come from the raw text so the list doesn't shrink as you fill it. */
	const placeholders = $derived(findPlaceholders(compose));
	/** What we'd actually deploy: placeholders resolved. */
	const effective = $derived(substitutePlaceholders(compose, varValues));
	const inspection = $derived(inspectCompose(effective));
	const nameError = $derived(name ? validateAppName(name) : null);

	const unresolved = $derived(
		placeholders.filter((p) => !p.hasDefault && !(varValues[p.name] ?? '').trim())
	);
	const missingPaths = $derived(
		(pre?.paths ?? []).filter((p) => !p.exists && !provisioned[p.path])
	);

	const blockers = $derived.by(() => {
		const out: string[] = [];
		if (!name) out.push('Give the app a name.');
		else if (nameError) out.push(nameError);
		if (pre?.nameTaken) out.push(`An app called “${name}” already exists.`);
		if (!inspection.ok) out.push(inspection.error?.message ?? 'The compose file is not valid.');
		if (pre && pre.portConflicts.length > 0) {
			out.push(
				`Port ${pre.portConflicts.join(', ')} ${pre.portConflicts.length === 1 ? 'is' : 'are'} already in use.`
			);
		}
		if (unresolved.length > 0) {
			out.push(`Fill in ${unresolved.map((p) => p.name).join(', ')}.`);
		}
		// Suspect bind mounts get their own section with a picker, rather than
		// being prose telling you to go and edit YAML by hand.
		return out;
	});

	/** Relative binds are meaningless here, so they block. */
	const badPaths = $derived(inspection.suspectPaths.filter((p) => p.why === 'relative'));
	/**
	 * An absolute path outside /mnt only cautions. A read-only host mount is a
	 * legitimate pattern — /etc/localtime, a socket, or the app lifecycle log
	 * TrueWeb itself mounts — and blocking them all would refuse valid composes.
	 */
	const oddPaths = $derived(inspection.suspectPaths.filter((p) => p.why === 'outside-mnt'));

	const canDeploy = $derived(
		Boolean(pre) && blockers.length === 0 && badPaths.length === 0 && !deploying
	);

	// ── draft persistence (§5.2) ───────────────────────────────────────────
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const snapshot = JSON.stringify({ name, compose });
		clearTimeout(draftTimer);
		draftTimer = setTimeout(() => {
			try {
				localStorage.setItem(DRAFT_KEY, snapshot);
			} catch {
				/* private mode — a lost draft is bad but not fatal */
			}
		}, 400);
	});

	function clearDraft() {
		try {
			localStorage.removeItem(DRAFT_KEY);
		} catch {
			/* ignore */
		}
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem(DRAFT_KEY);
			if (saved) {
				const d = JSON.parse(saved) as { name?: string; compose?: string };
				if (d.compose) compose = d.compose;
				if (d.name) name = d.name;
			}
		} catch {
			/* ignore a corrupt draft */
		}

		const es = new EventSource('/api/stream');
		es.addEventListener('job', (e) => {
			const job = JSON.parse((e as MessageEvent).data) as {
				id?: number;
				state?: string;
				error?: string | null;
				exception?: string | null;
				progress?: { percent?: number; description?: string | null };
			};
			if (deployJob === null || job.id !== deployJob) return;
			if (typeof job.progress?.percent === 'number') deployPct = job.progress.percent;
			if (job.progress?.description) deployNote = job.progress.description;
			if (job.state === 'SUCCESS') {
				clearDraft();
				// Land on the app with its log tail already running (§5.2).
				void goto(`/apps/${encodeURIComponent(name)}`);
			} else if (job.state === 'FAILED' || job.state === 'ABORTED') {
				const failedId = deployJob;
				deploying = false;
				deployJob = null;
				// The draft is deliberately kept: the compose is worth fixing and
				// retrying, not retyping.
				failure = {
					error: job.error ?? job.state ?? 'The deploy failed.',
					exception: job.exception ?? ''
				};
				// The event can lag the finished record, so fill in from the job.
				void fetch(`/api/jobs/${failedId}`)
					.then((r) => (r.ok ? r.json() : null))
					.then((d: { error?: string | null; exception?: string | null } | null) => {
						if (d && failure) {
							failure = {
								error: d.error ?? failure.error,
								exception: d.exception ?? failure.exception
							};
						}
					})
					.catch(() => {});
			}
		});
		return () => es.close();
	});

	// ── editing ────────────────────────────────────────────────────────────

	function runSanitize() {
		const r = sanitizeCompose(compose);
		notes = r.changes;
		if (r.text !== compose) compose = r.text;
		// A fresh paste invalidates any previous check.
		pre = null;
		// Offer the apps account, or whatever the compose asks for.
		const found = inspectCompose(substitutePlaceholders(r.text, varValues));
		uid = String(found.puid ?? DEFAULT_UID);
		gid = String(found.pgid ?? DEFAULT_GID);
		// Prefill the usual suspects if they appear as placeholders.
		const next = { ...varValues };
		for (const p of findPlaceholders(r.text)) {
			if (next[p.name] === undefined && /^(PUID|UID)$/.test(p.name)) next[p.name] = String(DEFAULT_UID);
			if (next[p.name] === undefined && /^(PGID|GID)$/.test(p.name)) next[p.name] = String(DEFAULT_GID);
		}
		varValues = next;
	}

	async function fetchFromUrl() {
		if (!url.trim()) return;
		fetching = true;
		try {
			const res = await fetch('/api/compose/fetch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: url.trim() })
			});
			const body = await res.json().catch(() => ({}) as { text?: string; message?: string });
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			compose = body.text ?? '';
			runSanitize();
			if (!name) {
				const repo = repoNameFromUrl(url);
				const guess = repo ? suggestAppName(repo) : '';
				if (guess && !validateAppName(guess)) name = guess;
			}
		} catch (err) {
			toastMsg = (err as Error).message;
		} finally {
			fetching = false;
		}
	}

	// ── pre-flight ─────────────────────────────────────────────────────────

	async function check() {
		if (!inspection.ok || nameError || !name) {
			toastMsg = 'Fix the name and the YAML first.';
			return;
		}
		checking = true;
		try {
			const res = await fetch('/api/compose/preflight', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, ports: inspection.hostPorts, paths: inspection.hostPaths })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			pre = body as PreflightResult;
			const nextKinds: typeof kinds = {};
			for (const p of pre.paths) if (!p.exists) nextKinds[p.path] = p.recommended;
			kinds = nextKinds;
			// Seed the port fields from the suggestions, so "Change" works without
			// having to type over the value first.
			const nextPorts: Record<number, string> = {};
			for (const s of pre.portSuggestions ?? []) nextPorts[s.port] = String(s.suggested);
			portEdits = nextPorts;
		} catch (err) {
			toastMsg = `Check failed: ${(err as Error).message}`;
		} finally {
			checking = false;
		}
	}

	async function provision(report: PathReport) {
		const kind = kinds[report.path] ?? report.recommended;
		working = { ...working, [report.path]: true };
		try {
			const res = await fetch('/api/paths/provision', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: report.path, kind, from: report.existingAncestor })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			provisioned = { ...provisioned, [report.path]: kind };
		} catch (err) {
			toastMsg = `Could not create ${report.path}: ${(err as Error).message}`;
		} finally {
			working = { ...working, [report.path]: false };
		}
	}

	async function applyChown(path: string) {
		working = { ...working, [path]: true };
		try {
			const res = await fetch('/api/paths/chown', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path, uid: Number(uid), gid: Number(gid), recursive: true })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			toastMsg = `Ownership of ${path} set to ${uid}:${gid}.`;
		} catch (err) {
			toastMsg = `Could not set ownership: ${(err as Error).message}`;
		} finally {
			working = { ...working, [path]: false };
		}
	}

	/** Re-point a bind mount by browsing for a location instead of hand-editing. */
	function openPicker(source: string) {
		pickerFor = source;
		// Start somewhere useful: the path's own parent if it's under /mnt.
		pickerStart = source.startsWith('/mnt/')
			? source.slice(0, source.lastIndexOf('/')) || '/mnt'
			: '/mnt';
		pickerOpen = true;
	}

	function applyPickedPath(chosen: string) {
		const { text, replaced } = replaceVolumeSource(compose, pickerFor, chosen);
		if (replaced === 0) {
			toastMsg = `Couldn't find “${pickerFor}” in the YAML to update.`;
			return;
		}
		compose = text;
		// The paths in the previous check no longer describe this file.
		pre = null;
		toastMsg = `Pointed at ${chosen}.`;
		pickerFor = '';
	}

	function applyPortChange(oldPort: number) {
		const suggested = pre?.portSuggestions.find((s) => s.port === oldPort)?.suggested;
		const raw = portEdits[oldPort] ?? (suggested !== undefined ? String(suggested) : '');
		const next = Number(raw);
		if (!Number.isInteger(next) || next < 1 || next > 65535) {
			toastMsg = 'Enter a port between 1 and 65535.';
			return;
		}
		const { text, replaced } = replaceHostPort(compose, oldPort, next);
		if (replaced === 0) {
			toastMsg = `Couldn't rewrite port ${oldPort} automatically — edit it in the YAML.`;
			return;
		}
		compose = text;
		pre = null;
		toastMsg = `Port ${oldPort} → ${next}. Check again.`;
	}

	/** Skip anything this compose already publishes, and any known conflict. */
	function suggestFreePort(from: number): number {
		return nextFreePort(from, [...inspection.hostPorts, ...(pre?.portConflicts ?? [])]);
	}

	/** Rewrite a clashing host port straight from the failure panel. */
	function changeClashingPort(from: number, to: number) {
		const { text, replaced } = replaceHostPort(compose, from, to);
		if (replaced === 0) {
			toastMsg = `Couldn't rewrite port ${from} automatically — change it in the YAML.`;
			return;
		}
		compose = text;
		pre = null;
		failure = null;
		toastMsg = `Port ${from} → ${to}. Check again, then deploy.`;
	}

	async function deploy() {
		if (!canDeploy) return;
		deploying = true;
		failure = null;
		deployPct = undefined;
		deployNote = 'Creating…';
		try {
			const res = await fetch('/api/apps/create', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, compose: effective })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			deployJob = typeof body.jobId === 'number' ? body.jobId : null;
			if (deployJob === null) {
				clearDraft();
				void goto(`/apps/${encodeURIComponent(name)}`);
			}
		} catch (err) {
			deploying = false;
			toastMsg = `Deploy failed: ${(err as Error).message}`;
		}
	}
</script>

<header class="head">
	<a class="back" href="/apps" aria-label="Back to apps">←</a>
	<div class="title">
		<h1>New app</h1>
		<div class="sub">Paste a docker-compose file</div>
	</div>
</header>

{#if !data.reachable}
	<div class="empty">
		<div class="icon">⚠</div>
		<h2>{data.configured ? "Can't reach TrueNAS" : 'Not configured'}</h2>
		<p class="dim">{data.reason}</p>
	</div>
{:else}
	<section class="card">
		<h2>Name</h2>
		<input
			class="text"
			bind:value={name}
			placeholder="my-app"
			spellcheck="false"
			autocapitalize="off"
			autocorrect="off"
			autocomplete="off"
			aria-label="App name"
		/>
		{#if name && nameError}<p class="err">{nameError}</p>{/if}
		{#if pre?.nameTaken}<p class="err">That name is already taken.</p>{/if}
	</section>

	<section class="card">
		<h2>Compose file</h2>
		<div class="urlrow">
			<input
				class="text"
				bind:value={url}
				placeholder="https://github.com/owner/repo"
				spellcheck="false"
				autocapitalize="off"
				autocorrect="off"
				inputmode="url"
				aria-label="GitHub URL"
			/>
			<button class="ghost" disabled={fetching || !url.trim()} onclick={fetchFromUrl}>
				{fetching ? '…' : 'Fetch'}
			</button>
		</div>
		<p class="dim small urlhelp">
			Paste a GitHub repo, folder or file link — a repo is searched for
			<code>docker-compose.yml</code> and friends.
		</p>

		<ComposeEditor
			bind:value={compose}
			onpasted={runSanitize}
			placeholder={'services:\n  app:\n    image: ghcr.io/example/app\n    ports:\n      - "8080:80"'}
		/>

		<div class="editrow">
			<button class="ghost" onclick={runSanitize} disabled={!compose}>Clean up</button>
			{#if inspection.ok}
				<span class="ok">
					✓ {inspection.serviceNames.length} service{inspection.serviceNames.length === 1
						? ''
						: 's'}
				</span>
			{/if}
		</div>

		{#if notes.length > 0}
			<div class="notes">
				<strong>Fixed on paste</strong>
				<ul>
					{#each notes as n (n)}<li>{n}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if compose && !inspection.ok}
			<p class="err">
				{#if inspection.error?.line}Line {inspection.error.line}: {/if}{inspection.error?.message}
			</p>
		{/if}
	</section>

	{#if placeholders.length > 0}
		<section class="card">
			<h2>Variables</h2>
			<p class="dim small">
				This compose file expects values that would normally come from a
				<code>.env</code> file. They're substituted before deploying.
			</p>
			{#each placeholders as p (p.name)}
				<div class="varrow">
					<label for={`var-${p.name}`}>
						{p.name}
						{#if p.hasDefault}<span class="opt">has default</span>{/if}
					</label>
					<input
						id={`var-${p.name}`}
						class="text"
						value={varValues[p.name] ?? ''}
						oninput={(e) => (varValues = { ...varValues, [p.name]: e.currentTarget.value })}
						placeholder={p.hasDefault ? 'default' : 'required'}
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
					/>
				</div>
			{/each}
		</section>
	{/if}

	<section class="card">
		<div class="checkrow">
			<h2>Pre-flight</h2>
			<button class="ghost" onclick={check} disabled={checking || !compose || !name}>
				{checking ? 'Checking…' : pre ? 'Re-check' : 'Check'}
			</button>
		</div>

		{#if !pre}
			<p class="dim small">
				Checks the name, the published ports, and every <code>/mnt</code> path the compose file
				mounts.
			</p>
		{:else}
			{#if pre.portConflicts.length > 0}
				<div class="fixlist">
					<p class="err">
						{pre.portConflicts.length === 1 ? 'This port is' : 'These ports are'} already in use.
						Change {pre.portConflicts.length === 1 ? 'it' : 'them'} here and the YAML is updated.
					</p>
					{#each pre.portSuggestions as s (s.port)}
						<div class="fixrow">
							<code>{s.port}</code>
							<span class="arrow" aria-hidden="true">→</span>
							<input
								class="text port"
								value={portEdits[s.port] ?? String(s.suggested)}
								oninput={(e) => (portEdits = { ...portEdits, [s.port]: e.currentTarget.value })}
								inputmode="numeric"
								aria-label={`New host port for ${s.port}`}
							/>
							<button class="tiny go" onclick={() => applyPortChange(s.port)}>Change</button>
						</div>
					{/each}
				</div>
			{:else if inspection.hostPorts.length > 0}
				<p class="ok small">
					{inspection.hostPorts.join(', ')} — no clash with another app
				</p>
				<p class="dim small">
					TrueNAS can only report ports held by apps, so a port used by anything else won't show
					up until the container tries to start.
				</p>
			{/if}

			{#if pre.paths.length === 0}
				<p class="dim small">No host paths to create.</p>
			{:else}
				<ul class="paths">
					{#each pre.paths as p (p.path)}
						{@const done = provisioned[p.path]}
						{@const busy = working[p.path]}
						<li>
							<div class="pathhead">
								<code>{p.path}</code>
								{#if p.exists}
									<span class="tag ok">exists</span>
								{:else if done}
									<span class="tag ok">created</span>
								{:else}
									<span class="tag warn">missing</span>
								{/if}
							</div>

							{#if p.exists}
								<div class="pathmeta">
									{p.type?.toLowerCase()}{p.isMountpoint ? ' · dataset' : ''} · owner
									{p.uid}:{p.gid}{p.owner ? ` (${p.owner})` : ''}
								</div>
								<div class="pathactions">
									<button class="tiny" disabled={busy} onclick={() => applyChown(p.path)}>
										Set owner to {uid}:{gid}
									</button>
									<button class="tiny" onclick={() => openPicker(p.path)}>Change…</button>
								</div>
							{:else if done}
								<div class="pathmeta">Created as {done}.</div>
								<button class="tiny" disabled={busy} onclick={() => applyChown(p.path)}>
									Set owner to {uid}:{gid}
								</button>
							{:else}
								{#if p.note}<div class="pathmeta">{p.note}</div>{/if}
								{#if p.existingAncestor}
									<div class="kindrow">
										{#if p.datasetName}
											<label class="radio">
												<input
													type="radio"
													name={`kind-${p.path}`}
													checked={(kinds[p.path] ?? p.recommended) === 'dataset'}
													onchange={() => (kinds = { ...kinds, [p.path]: 'dataset' })}
												/>
												Dataset <code class="sm">{p.datasetName}</code>
											</label>
										{/if}
										<label class="radio">
											<input
												type="radio"
												name={`kind-${p.path}`}
												checked={(kinds[p.path] ?? p.recommended) === 'directory'}
												onchange={() => (kinds = { ...kinds, [p.path]: 'directory' })}
											/>
											Directory
										</label>
									</div>
									<div class="pathactions">
										<button class="tiny go" disabled={busy} onclick={() => provision(p)}>
											{busy ? 'Creating…' : 'Create'}
										</button>
										<button class="tiny" onclick={() => openPicker(p.path)}>Choose…</button>
									</div>
								{:else}
									<button class="tiny" onclick={() => openPicker(p.path)}>Choose a location…</button>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>

				<div class="ownrow">
					<span class="dim small">Owner for created paths</span>
					<div class="ids">
						<input class="text id" bind:value={uid} inputmode="numeric" aria-label="UID" />
						<span class="colon">:</span>
						<input class="text id" bind:value={gid} inputmode="numeric" aria-label="GID" />
					</div>
				</div>
				<p class="dim small">
					A path owned by root leaves most containers unable to write, which shows up later as a
					crash loop. {DEFAULT_UID}:{DEFAULT_GID} is the <code>apps</code> account.
				</p>
			{/if}
		{/if}
	</section>

	{#if badPaths.length > 0}
		<section class="card blockers">
			<h2>These mounts need a real location</h2>
			{#each badPaths as s (s.source)}
				<div class="fixpath">
					<code>{s.source}</code>
					<p class="small">Relative to nothing — a custom app has no project folder to sit in.</p>
					<button class="tiny go" onclick={() => openPicker(s.source)}>Choose a location…</button>
				</div>
			{/each}
		</section>
	{/if}

	{#if oddPaths.length > 0}
		<section class="card warnbox">
			<h2>Mounted from outside /mnt</h2>
			{#each oddPaths as s (s.source)}
				<div class="fixpath">
					<code>{s.source}</code>
					<p class="small">
						Fine for a read-only host file such as a log or <code>/etc/localtime</code>. If it's
						meant to hold app data, put it under /mnt — on the boot pool it isn't backed up and
						isn't part of a pool.
					</p>
					<button class="tiny" onclick={() => openPicker(s.source)}>Choose a location…</button>
				</div>
			{/each}
		</section>
	{/if}

	{#if blockers.length > 0}
		<section class="card blockers">
			<h2>Before deploying</h2>
			<ul>
				{#each blockers as b (b)}<li>{b}</li>{/each}
			</ul>
		</section>
	{:else if pre && missingPaths.length > 0}
		<section class="card warnbox">
			<h2>Heads up</h2>
			<p class="small">
				{missingPaths.length} path{missingPaths.length === 1 ? '' : 's'} still missing. Docker will
				create {missingPaths.length === 1 ? 'it' : 'them'} as root, which usually means the container
				can't write.
			</p>
		</section>
	{/if}

	{#if failure}
		<JobFailure
			title="Deploy failed"
			error={failure.error}
			exception={failure.exception}
			app={name}
			onretry={deploy}
			ondismiss={() => (failure = null)}
			suggestPort={suggestFreePort}
			onchangeport={changeClashingPort}
		/>
	{/if}

	<div class="bar">
		{#if deploying}
			<div class="progress" role="status">
				<span class="spin" aria-hidden="true"></span>
				<span>{deployNote || 'Deploying…'}{deployPct ? ` ${deployPct}%` : ''}</span>
			</div>
		{:else}
			<button class="deploy" disabled={!canDeploy} onclick={deploy}>
				{pre ? 'Deploy' : 'Check first'}
			</button>
		{/if}
	</div>
{/if}

<PathPicker
	bind:open={pickerOpen}
	start={pickerStart}
	title={pickerFor ? `Location for ${pickerFor}` : 'Choose a location'}
	onpick={applyPickedPath}
/>
<Toast bind:message={toastMsg} />

<style>
	.head {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(var(--sa-top) + 12px) 16px 12px;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
	}
	.back {
		flex: none;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--surface-2);
		color: var(--text);
		font-size: 20px;
		text-decoration: none;
	}
	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.sub {
		font-size: 12px;
		color: var(--text-faint);
	}

	.card {
		margin: 12px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r);
	}
	.card h2 {
		margin: 0 0 10px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.card.blockers {
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
		background: color-mix(in srgb, var(--danger) 8%, var(--surface));
	}
	.card.warnbox {
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
		background: color-mix(in srgb, var(--warn) 8%, var(--surface));
	}
	.blockers ul,
	.notes ul {
		margin: 0;
		padding-left: 18px;
		font-size: 13px;
	}

	.text {
		width: 100%;
		min-height: 44px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font: inherit;
		font-size: 15px;
		padding: 8px 12px;
	}
	.text:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.urlrow {
		display: flex;
		gap: 8px;
	}
	.urlhelp {
		margin: 6px 0 10px;
	}
	.editrow,
	.checkrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 10px;
	}
	.checkrow {
		margin: 0 0 10px;
	}
	.checkrow h2 {
		margin: 0;
	}

	button.ghost,
	button.tiny {
		flex: none;
		min-height: 44px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
	}
	button.tiny {
		min-height: 38px;
		font-size: 13px;
		margin-top: 8px;
	}
	button.tiny.go {
		border-color: transparent;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	button:disabled {
		opacity: 0.45;
	}

	.notes {
		margin-top: 10px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--info) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--info) 32%, transparent);
		font-size: 13px;
	}
	.notes strong {
		display: block;
		margin-bottom: 4px;
	}

	.err {
		margin: 8px 0 0;
		color: var(--danger);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.ok {
		color: var(--ok);
		font-size: 13px;
		font-weight: 600;
	}
	.dim {
		color: var(--text-dim);
	}
	.small {
		font-size: 13px;
	}

	.varrow {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
	}
	.varrow label {
		flex: 0 0 40%;
		font-size: 13px;
		font-family: var(--mono);
		overflow-wrap: anywhere;
	}
	.opt {
		display: block;
		font-family: var(--font);
		font-size: 10px;
		color: var(--text-faint);
	}

	/* Inline fixers: change a clashing port, or re-point a bad mount. */
	.fixlist {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fixrow {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fixrow code {
		flex: none;
		color: var(--danger);
	}
	.arrow {
		color: var(--text-faint);
	}
	.text.port {
		width: 96px;
		text-align: center;
		font-family: var(--mono);
		min-height: 40px;
	}
	.fixpath {
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.fixpath:first-of-type {
		border-top: 0;
	}
	.fixpath p {
		margin: 4px 0 0;
		color: var(--text-dim);
	}
	.pathactions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.paths {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.paths li {
		padding: 10px 0;
		border-top: 1px solid var(--border);
	}
	.paths li:first-child {
		border-top: 0;
	}
	.pathhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.pathhead code,
	code {
		font-family: var(--mono);
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	code.sm {
		font-size: 11px;
		color: var(--text-dim);
	}
	.pathmeta {
		font-size: 12px;
		color: var(--text-faint);
		margin-top: 3px;
	}
	.tag {
		flex: none;
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		text-transform: uppercase;
	}
	.tag.ok {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 15%, transparent);
	}
	.tag.warn {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 15%, transparent);
	}
	.kindrow {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.radio {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}
	.radio input {
		width: 20px;
		height: 20px;
		accent-color: var(--accent);
	}

	.ownrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.ids {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.text.id {
		width: 78px;
		text-align: center;
		font-family: var(--mono);
	}
	.colon {
		color: var(--text-faint);
	}

	.bar {
		position: sticky;
		bottom: 0;
		padding: 10px 16px calc(12px + var(--sa-bottom));
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
	}
	.deploy {
		width: 100%;
		min-height: 52px;
		border: none;
		border-radius: var(--r);
		font-size: 16px;
		font-weight: 700;
		color: var(--on-accent);
		background: var(--accent-grad);
	}
	.progress {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 52px;
		font-size: 14px;
		font-weight: 600;
		color: var(--info);
	}
	.spin {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--info) 30%, transparent);
		border-top-color: var(--info);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty {
		text-align: center;
		padding: 64px 24px;
	}
	.empty .icon {
		font-size: 36px;
	}
</style>
