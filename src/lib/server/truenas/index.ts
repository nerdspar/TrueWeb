/** TrueNAS middleware client layer (Milestone 1). Public surface. */
export { TrueNasClient } from './client.ts';
export type { ClientConfig, AuthMe, SubscriptionHandler } from './client.ts';
export { loadConfig } from './env.ts';
export { JobRegistry, JobError, isTerminalState } from './jobs.ts';
export type { Job, JobState, JobProgress } from './jobs.ts';
export {
	ALLOWLIST,
	DENYLIST,
	assertAllowed,
	isAllowed,
	isJobMethod,
	MethodNotAllowedError
} from './allowlist.ts';
export type { Tier, MethodSpec } from './allowlist.ts';
export {
	MiddlewareError,
	NotConnectedError,
	AuthError
} from './protocol.ts';
export type { CollectionUpdate } from './protocol.ts';
export { makeLogger, NULL_LOGGER, redact } from './log.ts';
export type { Logger } from './log.ts';
export * as methods from './methods.ts';
export type { AppRecord, AppState } from './methods.ts';
