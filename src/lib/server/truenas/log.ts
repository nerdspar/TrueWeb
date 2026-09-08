/**
 * A tiny leveled logger.
 *
 * Secret hygiene (hard rule #5): this logger is only ever handed message
 * strings, never request params. The client logs method names and job/
 * subscription lifecycle, never the params array — so the API key (which only
 * ever appears in auth.login_ex params) has no path into a log line. `redact`
 * is provided for the rare case where a value must be shown near a secret.
 */

export interface Logger {
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
	debug(msg: string): void;
}

function ts(): string {
	return new Date().toISOString();
}

export function makeLogger(prefix = 'trueweb', debugEnabled = Boolean(process.env.TRUEWEB_DEBUG)): Logger {
	const tag = (level: string) => `${ts()} ${prefix} ${level}`;
	return {
		info: (m) => console.error(`${tag('info')}  ${m}`),
		warn: (m) => console.error(`${tag('warn')}  ${m}`),
		error: (m) => console.error(`${tag('error')} ${m}`),
		debug: (m) => {
			if (debugEnabled) console.error(`${tag('debug')} ${m}`);
		}
	};
}

/** Silent logger for tests and library embedding. */
export const NULL_LOGGER: Logger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {}
};

/** Mask all but the last `keep` characters of a secret for display. */
export function redact(secret: string, keep = 0): string {
	if (!secret) return '';
	if (keep <= 0 || secret.length <= keep) return '••••••';
	return `••••••${secret.slice(-keep)}`;
}
