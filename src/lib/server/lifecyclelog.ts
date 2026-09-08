/**
 * The TrueNAS app lifecycle log.
 *
 * When bringing an app up fails, the middleware records a one-line error
 * pointing at /var/log/app_lifecycle.log and leaves the job's own logs_path and
 * logs_excerpt null (verified against a real failure on this box). That file
 * lives on the *host*, not in any container, and the only API route to it is
 * filesystem.get — a job that produces a file for the HTTP download endpoint,
 * which this project deliberately doesn't use (§3.1).
 *
 * So it isn't fetched over the API at all. TrueWeb runs as a container on that
 * same host (§10), so the log is read straight off disk when the operator
 * bind-mounts it read-only:
 *
 *     volumes:
 *       - /var/log/app_lifecycle.log:/var/log/app_lifecycle.log:ro
 *
 * Absent that mount (or in dev on a laptop) it reports itself unavailable and
 * the UI says how to switch it on, rather than failing obscurely.
 */
import { env } from '$env/dynamic/private';
import { readTail, type LogTail } from './logtail.ts';

const DEFAULT_PATH = '/var/log/app_lifecycle.log';

export type { LogTail as LifecycleLog };

export const lifecycleLogPath = (): string => env.TRUEWEB_APP_LIFECYCLE_LOG || DEFAULT_PATH;

export function readLifecycleLog(opts: { app?: string; lines?: number }): Promise<LogTail> {
	return readTail(lifecycleLogPath(), opts);
}
