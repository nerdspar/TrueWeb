/**
 * The method allowlist (§6, hard rule #4).
 *
 * Every outgoing middleware call passes through assertAllowed() — it is the
 * single choke point in the client (see client.ts `send`). A method not in this
 * map is refused before it reaches the socket, so a bug in a future UI cannot
 * reach an unlisted method. The §6 "never expose" methods additionally sit in
 * DENYLIST so the refusal message is explicit rather than a generic miss.
 *
 * The tier is carried here, not in the UI, per §6: the backend route table is
 * the authority on how destructive a call is. M1 has no UI, so tiers do not
 * gate anything yet — but the classification ships now and the mutation guards
 * in M2+ read it from here.
 *
 * Signature verification (hard rule #2): entries marked `verified: true` have
 * had their argument shape confirmed against https://api.truenas.com/v25.10/
 * and are exercised by M1. The rest are name-gated now (so the allowlist is the
 * one source of truth) and their argument shapes are verified against the same
 * reference by the milestone that first calls them. The gate itself never
 * asserts a signature — it only decides whether a name may be sent.
 */

/** read = non-mutating / infrastructure; 1 / 2 / 2.5 = §6 mutation tiers. */
export type Tier = 'read' | 1 | 2 | 2.5;

export interface MethodSpec {
	tier: Tier;
	/** The middleware runs this as a job: the call returns a job id, not a result. */
	job?: boolean;
	/** Signature confirmed against v25.10 and used in this milestone. */
	verified?: boolean;
}

export const ALLOWLIST: Readonly<Record<string, MethodSpec>> = {
	// ── auth + connection infrastructure ─────────────────────────────────────
	'auth.login_ex': { tier: 'read', verified: true },
	'auth.me': { tier: 'read', verified: true },

	// ── subscription + job infrastructure ────────────────────────────────────
	'core.ping': { tier: 'read', verified: true },
	'core.subscribe': { tier: 'read', verified: true },
	'core.unsubscribe': { tier: 'read', verified: true },
	'core.get_jobs': { tier: 'read', verified: true },
	'core.job_wait': { tier: 'read', job: true, verified: true },
	'core.job_abort': { tier: 'read', verified: true },

	// ── apps: read (§5.1 / §5.2) ─────────────────────────────────────────────
	'app.query': { tier: 'read', verified: true },
	'app.get_instance': { tier: 'read' },
	'app.config': { tier: 'read' },
	'app.container_ids': { tier: 'read' },
	'app.used_ports': { tier: 'read' },
	'app.used_host_ips': { tier: 'read' },
	'app.image.query': { tier: 'read' },
	'app.outdated_docker_images': { tier: 'read' },
	'app.upgrade_summary': { tier: 'read' },
	'app.rollback_versions': { tier: 'read' },
	'app.container_log_follow': { tier: 'read' },
	'app.stats': { tier: 'read' },
	'app.available': { tier: 'read' },
	'catalog.get_app_details': { tier: 'read' },

	// ── apps: tier 1 (one tap, no confirmation) ──────────────────────────────
	'app.start': { tier: 1, job: true, verified: true },
	'app.redeploy': { tier: 1, job: true, verified: true },

	// ── apps: tier 2 (confirmation naming the target) ────────────────────────
	'app.stop': { tier: 2, job: true, verified: true },
	'app.upgrade': { tier: 2, job: true },
	'app.rollback': { tier: 2, job: true },
	'app.create': { tier: 2, job: true },
	'app.update': { tier: 2, job: true },
	'app.pull_images': { tier: 2, job: true },

	// ── apps: tier 2.5 (irreversible; type-to-confirm) ───────────────────────
	'app.convert_to_custom': { tier: 2.5, job: true },

	// ── alerts ───────────────────────────────────────────────────────────────
	'alert.list': { tier: 'read' },
	'alert.dismiss': { tier: 1 },

	// ── dashboard reads (§5.4) ───────────────────────────────────────────────
	'system.info': { tier: 'read' },
	'webui.main.dashboard.sys_info': { tier: 'read' },
	'update.status': { tier: 'read' },

	// ── storage / pools reads (§5.5) ─────────────────────────────────────────
	'pool.query': { tier: 'read' },
	'zpool.query': { tier: 'read' },
	'pool.scrub.query': { tier: 'read' },
	'pool.get_disks': { tier: 'read' },
	'boot.get_state': { tier: 'read' },
	'disk.query': { tier: 'read' },
	'disk.details': { tier: 'read' },
	'disk.temperatures': { tier: 'read' },
	'disk.temperature_agg': { tier: 'read' },

	// ── storage: tier 2 ──────────────────────────────────────────────────────
	'pool.scrub.run': { tier: 2, job: true },

	// ── datasets reads (§5.6) ────────────────────────────────────────────────
	'pool.dataset.query': { tier: 'read' },
	'pool.dataset.details': { tier: 'read' },
	'pool.dataset.snapshot_count': { tier: 'read' },
	'pool.dataset.get_quota': { tier: 'read' },
	'pool.snapshot.query': { tier: 'read' },
	'filesystem.stat': { tier: 'read' },

	// ── datasets / filesystem: tier 2 ────────────────────────────────────────
	'pool.dataset.create': { tier: 2, job: true },
	'pool.dataset.set_quota': { tier: 2 },
	'pool.dataset.lock': { tier: 2, job: true },
	'pool.dataset.unlock': { tier: 2, job: true },
	'filesystem.mkdir': { tier: 2 },
	'filesystem.chown': { tier: 2, job: true }
};

/**
 * §6 "never expose" (tier 3) — plus system-level and reset methods. These are
 * refused with a distinct message. Not exposed behind any flag or confirmation.
 */
export const DENYLIST: ReadonlySet<string> = new Set([
	// storage restructuring / disk destruction (§5.5)
	'pool.create',
	'pool.expand',
	'pool.remove',
	'pool.replace',
	'pool.offline',
	'pool.export',
	'disk.wipe',
	// system / config (§6 tier 3)
	'system.reboot',
	'system.shutdown',
	'update.run',
	'config.reset'
]);

export class MethodNotAllowedError extends Error {
	readonly method: string;
	constructor(method: string, reason: string) {
		super(`refused middleware method "${method}": ${reason}`);
		this.name = 'MethodNotAllowedError';
		this.method = method;
	}
}

/** Throws unless `method` is on the allowlist. Returns its spec when allowed. */
export function assertAllowed(method: string): MethodSpec {
	const spec = ALLOWLIST[method];
	if (spec) return spec;
	const reason = DENYLIST.has(method)
		? 'destructive method that is never exposed (§6 tier 3)'
		: 'not on the allowlist (§6)';
	throw new MethodNotAllowedError(method, reason);
}

export function isAllowed(method: string): boolean {
	return method in ALLOWLIST;
}

export function isJobMethod(method: string): boolean {
	return ALLOWLIST[method]?.job === true;
}
