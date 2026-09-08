/**
 * The process-wide compose history (§5.3). Separate from composehistory.ts so
 * that module stays free of SvelteKit's env and remains directly testable.
 */
import { ComposeHistory } from './composehistory.ts';
import { STATE_DIR } from './config.ts';

export const history = new ComposeHistory({ dir: STATE_DIR() });
