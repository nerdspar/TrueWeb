/**
 * Configuration from environment variables only (§7). No secrets in the repo,
 * no secrets on disk beyond the operator's own .env.
 */
import { readFileSync } from 'node:fs';
import type { ClientConfig } from './client.ts';

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var ${name}. See .env.example.`);
	return v;
}

/** Strip any scheme and trailing slash from a host, keeping an explicit :port. */
function normalizeHost(raw: string): string {
	return raw.replace(/^\w+:\/\//, '').replace(/\/+$/, '');
}

/**
 * Build the client config from the process environment. Throws with a clear,
 * secret-free message if a required var is missing — a loud startup failure is
 * the intended behaviour (§7), not a silently unauthenticated client.
 */
export function loadConfig(): ClientConfig {
	const verifyTls = (process.env.TRUENAS_VERIFY_TLS ?? 'true').toLowerCase() !== 'false';
	const caFile = process.env.TRUENAS_CA_FILE;
	return {
		host: normalizeHost(required('TRUENAS_HOST')),
		apiKey: required('TRUENAS_API_KEY'),
		apiKeyUsername: required('TRUENAS_API_KEY_USERNAME'),
		verifyTls,
		ca: caFile ? readFileSync(caFile, 'utf8') : undefined
	};
}
