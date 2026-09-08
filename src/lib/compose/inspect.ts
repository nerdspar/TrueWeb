/**
 * Compose pre-flight inspection (§5.2). Runs client-side, before any API call,
 * so a parse error never round-trips through the server.
 *
 * Pure apart from the YAML parser, and unit tested — everything downstream
 * (port conflicts, dataset provisioning, the chown prefill) depends on getting
 * this extraction right.
 */
import { parseDocument } from 'yaml';

/** app.create's documented constraint, verified against v25.10. */
export const APP_NAME_RE = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
export const APP_NAME_MAX = 40;

export interface ComposeError {
	message: string;
	line?: number;
	column?: number;
}

export interface Placeholder {
	name: string;
	/** ${VAR:-default} supplies a fallback; ${VAR} and ${VAR:?err} do not. */
	hasDefault: boolean;
}

export interface ComposeInspection {
	ok: boolean;
	error?: ComposeError;
	serviceNames: string[];
	/** Published host ports, for the app.used_ports conflict check. */
	hostPorts: number[];
	/** Absolute /mnt bind-mount sources, for stat + provisioning. */
	hostPaths: string[];
	placeholders: Placeholder[];
	puid?: number;
	pgid?: number;
}

export function validateAppName(name: string): string | null {
	if (!name) return 'Give the app a name.';
	if (name.length > APP_NAME_MAX) return `Name must be ${APP_NAME_MAX} characters or fewer.`;
	if (!APP_NAME_RE.test(name)) {
		return 'Use lowercase letters, numbers and hyphens, starting with a letter and not ending with a hyphen.';
	}
	return null;
}

/* ─────────────────────────────── placeholders ─────────────────────────────── */

// $$ is an escaped literal dollar in compose, so it must not be treated as a
// reference. Groups: 1 $$, 2 braced name, 3 operator+value, 4 value, 5 bare name.
const PLACEHOLDER_RE =
	/(\$\$)|\$\{([A-Za-z_][A-Za-z0-9_]*)((?::?[-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function findPlaceholders(text: string): Placeholder[] {
	const found = new Map<string, boolean>();
	for (const m of text.matchAll(PLACEHOLDER_RE)) {
		if (m[1]) continue; // $$
		const name = m[2] ?? m[5];
		if (!name) continue;
		const hasDefault = Boolean(m[3] && /^:?-/.test(m[3]));
		// If a name appears both with and without a default, treat it as defaulted.
		found.set(name, (found.get(name) ?? false) || hasDefault);
	}
	return [...found].map(([name, hasDefault]) => ({ name, hasDefault }));
}

/** Fill ${VAR} references from `values`, falling back to any inline default. */
export function substitutePlaceholders(text: string, values: Record<string, string>): string {
	return text.replace(PLACEHOLDER_RE, (whole, dollars, braced, op, opValue, bare) => {
		if (dollars) return whole;
		const name: string | undefined = braced ?? bare;
		if (!name) return whole;
		const provided = values[name];
		if (provided !== undefined && provided !== '') return provided;
		if (op && /^:?-/.test(op)) return opValue ?? '';
		return whole; // unresolved — left visible rather than blanked out
	});
}

/* ───────────────────────────────── ports ──────────────────────────────────── */

function addPortSpec(value: unknown, out: Set<number>): void {
	if (typeof value === 'number') {
		if (Number.isInteger(value) && value > 0) out.add(value);
		return;
	}
	if (typeof value !== 'string') return;
	const spec = value.trim();
	if (!spec) return;

	const range = spec.match(/^(\d+)-(\d+)$/);
	if (range) {
		const from = Number(range[1]);
		const to = Number(range[2]);
		// Guard against a silly range turning into thousands of entries.
		if (to >= from && to - from <= 128) {
			for (let p = from; p <= to; p++) out.add(p);
		}
		return;
	}
	const n = Number(spec);
	if (Number.isInteger(n) && n > 0) out.add(n);
}

function collectPorts(entry: unknown, out: Set<number>): void {
	// Long syntax: { target, published, protocol }
	if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
		addPortSpec((entry as Record<string, unknown>).published, out);
		return;
	}
	// A bare number/`"3000"` publishes on a random host port — nothing to clash.
	if (typeof entry !== 'string') return;

	const spec = entry.split('/')[0] ?? ''; // drop /tcp, /udp
	const parts = spec.split(':');
	if (parts.length < 2) return; // container port only
	// "ip:host:container" → host is second-to-last; "host:container" → first.
	addPortSpec(parts.length >= 3 ? parts[parts.length - 2] : parts[0], out);
}

/* ───────────────────────────────── volumes ────────────────────────────────── */

function collectHostPath(entry: unknown, out: Set<string>): void {
	let source: unknown;
	if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
		const o = entry as Record<string, unknown>;
		if (o.type !== undefined && o.type !== 'bind') return;
		source = o.source;
	} else if (typeof entry === 'string') {
		source = entry.split(':')[0];
	}
	if (typeof source !== 'string') return;

	// Only host paths under /mnt are provisionable on TrueNAS; named volumes and
	// relative paths are not ours to create.
	const path = source.trim().replace(/\/+$/, '');
	if (path.startsWith('/mnt/') && path.length > '/mnt/'.length) out.add(path);
}

/* ─────────────────────────────── environment ──────────────────────────────── */

function readEnv(service: Record<string, unknown>): Record<string, string> {
	const env = service.environment;
	const out: Record<string, string> = {};
	if (!env) return out;
	if (Array.isArray(env)) {
		for (const item of env) {
			if (typeof item !== 'string') continue;
			const i = item.indexOf('=');
			if (i > 0) out[item.slice(0, i).trim()] = item.slice(i + 1).trim();
		}
	} else if (typeof env === 'object') {
		for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
			if (v !== null && v !== undefined) out[k] = String(v);
		}
	}
	return out;
}

/* ──────────────────────────────── inspection ──────────────────────────────── */

export function inspectCompose(text: string): ComposeInspection {
	const base: ComposeInspection = {
		ok: false,
		serviceNames: [],
		hostPorts: [],
		hostPaths: [],
		placeholders: findPlaceholders(text)
	};

	if (!text.trim()) {
		return { ...base, error: { message: 'Paste a docker-compose file to deploy.' } };
	}

	const doc = parseDocument(text);
	if (doc.errors.length > 0) {
		const err = doc.errors[0];
		const pos = err?.linePos?.[0];
		return {
			...base,
			error: { message: err?.message ?? 'The YAML could not be parsed.', line: pos?.line, column: pos?.col }
		};
	}

	const root = doc.toJS() as unknown;
	if (!root || typeof root !== 'object' || Array.isArray(root)) {
		return { ...base, error: { message: 'The compose file must be a YAML mapping of keys.' } };
	}

	const services = (root as Record<string, unknown>).services;
	if (!services || typeof services !== 'object' || Array.isArray(services)) {
		return {
			...base,
			error: {
				message:
					'No top-level "services:" key. TrueNAS rejects a compose file that only uses "include:" — paste the file that actually defines the services.'
			}
		};
	}

	const serviceMap = services as Record<string, unknown>;
	const serviceNames = Object.keys(serviceMap);
	if (serviceNames.length === 0) {
		return { ...base, error: { message: '"services:" is empty — there is nothing to deploy.' } };
	}

	const ports = new Set<number>();
	const paths = new Set<string>();
	let puid: number | undefined;
	let pgid: number | undefined;

	for (const name of serviceNames) {
		const svc = serviceMap[name];
		if (!svc || typeof svc !== 'object' || Array.isArray(svc)) continue;
		const service = svc as Record<string, unknown>;

		if (Array.isArray(service.ports)) for (const p of service.ports) collectPorts(p, ports);
		if (Array.isArray(service.volumes)) for (const v of service.volumes) collectHostPath(v, paths);

		const env = readEnv(service);
		// First numeric PUID/PGID wins — it prefills the chown, and is shown
		// rather than applied automatically (§5.2).
		if (puid === undefined && env.PUID !== undefined) {
			const n = Number(env.PUID);
			if (Number.isInteger(n) && n >= 0) puid = n;
		}
		if (pgid === undefined && env.PGID !== undefined) {
			const n = Number(env.PGID);
			if (Number.isInteger(n) && n >= 0) pgid = n;
		}
	}

	return {
		ok: true,
		serviceNames,
		hostPorts: [...ports].sort((a, b) => a - b),
		hostPaths: [...paths].sort(),
		placeholders: base.placeholders,
		puid,
		pgid
	};
}
