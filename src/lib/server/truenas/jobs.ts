/**
 * Job correlation (hard rule #3).
 *
 * Mutating methods (app.start, app.stop, app.redeploy, app.create, …) are jobs:
 * the call returns a job id immediately, and the outcome arrives asynchronously
 * on the `core.get_jobs` subscription. The client keeps ONE such subscription
 * and feeds every update through JobRegistry.ingest(); a caller that issued a
 * job calls register(id) to get a promise that settles on completion and a
 * progress callback in between.
 *
 * The race that this class exists to handle: the `core.get_jobs` "added"
 * notification for a job can arrive on the socket *before* the originating call
 * resolves with the job id. Both are messages on one ordered connection, but
 * their relative order is not guaranteed. So ingest() buffers snapshots for ids
 * nobody has registered yet, and register() drains that buffer — a job can even
 * be already terminal by the time we learn its id, and it still settles
 * correctly. The client additionally seeds state with a one-shot core.get_jobs
 * query after each job call, which closes the window where an event was missed
 * entirely (e.g. the job finished during a reconnect).
 */

export type JobState = 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'ABORTED' | (string & {});

export interface JobProgress {
	percent?: number;
	description?: string | null;
}

export interface Job {
	id: number;
	method?: string;
	state: JobState;
	progress?: JobProgress;
	result?: unknown;
	error?: string | null;
	exception?: string | null;
}

const TERMINAL: ReadonlySet<string> = new Set(['SUCCESS', 'FAILED', 'ABORTED']);
export function isTerminalState(state: string): boolean {
	return TERMINAL.has(state);
}

/** A job that ended in FAILED or ABORTED. Carries the final job object. */
export class JobError extends Error {
	readonly job: Job;
	constructor(job: Job) {
		super(`job ${job.id} (${job.method ?? 'unknown'}) ${job.state}: ${job.error ?? job.exception ?? 'no detail'}`);
		this.name = 'JobError';
		this.job = job;
	}
}

export interface RegisterOptions {
	method?: string;
	onProgress?: (job: Job) => void;
}

interface Pending {
	job: Job;
	promise: Promise<Job>;
	resolve: (job: Job) => void;
	reject: (err: JobError) => void;
	onProgress?: (job: Job) => void;
	settled: boolean;
}

function mergeJob(prev: Job | undefined, next: Job): Job {
	return {
		...prev,
		...next,
		id: next.id,
		// A terminal event may omit progress; keep the last known value.
		progress: next.progress ?? prev?.progress
	};
}

export class JobRegistry {
	private readonly pending = new Map<number, Pending>();
	/** Snapshots for jobs seen before anyone registered interest (the race). */
	private readonly recent = new Map<number, Job>();
	private readonly recentMax: number;

	constructor(recentMax = 512) {
		this.recentMax = recentMax;
	}

	/**
	 * Declare interest in a job id and get a promise for its completion. Safe to
	 * call before or after the first event for that job has arrived. Calling
	 * twice for the same id returns the same promise (and updates onProgress).
	 */
	register(id: number, opts: RegisterOptions = {}): Promise<Job> {
		const existing = this.pending.get(id);
		if (existing) {
			if (opts.onProgress) existing.onProgress = opts.onProgress;
			return existing.promise;
		}

		let resolve!: (job: Job) => void;
		let reject!: (err: JobError) => void;
		const promise = new Promise<Job>((res, rej) => {
			resolve = res;
			reject = rej;
		});

		const pending: Pending = {
			job: { id, method: opts.method, state: 'WAITING' },
			promise,
			resolve,
			reject,
			onProgress: opts.onProgress,
			settled: false
		};
		this.pending.set(id, pending);

		// Drain any snapshot that arrived before this registration.
		const buffered = this.recent.get(id);
		if (buffered) {
			this.recent.delete(id);
			// Microtask so the returned promise/onProgress are fully wired first.
			queueMicrotask(() => this.ingest(buffered));
		}

		return promise;
	}

	/** Feed a job snapshot (from a core.get_jobs event or a seed query). */
	ingest(update: Job): void {
		if (!Number.isFinite(update.id)) return;
		const pending = this.pending.get(update.id);

		if (!pending) {
			// No one is waiting yet — remember the latest snapshot for the race.
			this.recent.set(update.id, mergeJob(this.recent.get(update.id), update));
			this.evictIfNeeded();
			return;
		}

		if (pending.settled) return;

		pending.job = mergeJob(pending.job, update);
		if (pending.onProgress) {
			try {
				pending.onProgress(pending.job);
			} catch {
				/* a caller's progress handler must never break correlation */
			}
		}

		if (isTerminalState(pending.job.state)) {
			pending.settled = true;
			this.pending.delete(update.id);
			if (pending.job.state === 'SUCCESS') pending.resolve(pending.job);
			else pending.reject(new JobError(pending.job));
		}
	}

	/** Ids with an unsettled registration — used to re-seed after a reconnect. */
	pendingIds(): number[] {
		return [...this.pending.keys()];
	}

	/** Fail every pending job, e.g. when the client is shut down for good. */
	rejectAll(err: JobError | Error): void {
		for (const [id, pending] of this.pending) {
			pending.settled = true;
			pending.reject(err instanceof JobError ? err : new JobError({ ...pending.job, state: 'FAILED', error: err.message }));
			this.pending.delete(id);
		}
	}

	private evictIfNeeded(): void {
		while (this.recent.size > this.recentMax) {
			const oldest = this.recent.keys().next().value;
			if (oldest === undefined) break;
			this.recent.delete(oldest);
		}
	}
}
