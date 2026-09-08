/**
 * Configuration from environment variables only (§7). No secrets in the repo,
 * no secrets on disk beyond the operator's own .env.
 *
 * `configFrom` takes any env source so callers can supply the right one:
 *   - the CLI and production (adapter-node) use process.env via loadConfig();
 *   - the SvelteKit app passes $env/dynamic/private (see service.ts), which is
 *     how a dev-mode .env reaches the server — Vite does not populate
 *     process.env from .env files.
 * This module itself stays framework-free (no $env import) so the client layer
 * remains portable and node-type-checkable.
 */
import { readFileSync } from 'node:fs';
import type { ClientConfig } from './client.ts';

export type EnvSource = Record<string, string | undefined>;

/** Strip any scheme and trailing slash from a host, keeping an explicit :port. */
function normalizeHost(raw: string): string {
	return raw.replace(/^\w+:\/\//, '').replace(/\/+$/, '');
}

/**
 * Build the client config from an env source. Throws with a clear, secret-free
 * message if a required var is missing — a loud failure is the intended
 * behaviour (§7), not a silently unauthenticated client.
 */
export function configFrom(source: EnvSource): ClientConfig {
	const required = (name: string): string => {
		const v = source[name];
		if (!v) throw new Error(`Missing required env var ${name}. See .env.example.`);
		return v;
	};
	const verifyTls = (source.TRUENAS_VERIFY_TLS ?? 'true').toLowerCase() !== 'false';
	const caFile = source.TRUENAS_CA_FILE;
	return {
		host: normalizeHost(required('TRUENAS_HOST')),
		apiKey: required('TRUENAS_API_KEY'),
		apiKeyUsername: required('TRUENAS_API_KEY_USERNAME'),
		verifyTls,
		ca: caFile ? readFileSync(caFile, 'utf8') : undefined,
		tlsServername: source.TRUENAS_TLS_SERVERNAME
	};
}

/** Config from the process environment (CLI + production). */
export function loadConfig(): ClientConfig {
	return configFrom(process.env);
}
