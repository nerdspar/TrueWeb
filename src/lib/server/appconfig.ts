/**
 * Reading and writing a custom app's compose (§5.3).
 *
 * A caveat worth knowing: app.config does NOT hand back the YAML that was
 * pasted. It returns the *parsed* compose as a structured object (verified on a
 * real custom app: the keys are the compose document's own, `services`,
 * `networks`, …). TrueNAS keeps the structure, not the text — so the editor is
 * loaded with a re-serialisation, and any comments or formatting from the
 * original paste are already gone before TrueWeb sees it. The diff shown before
 * saving is therefore against the current *config*, which is the thing being
 * changed, and is honest about it.
 */
import { stringify } from 'yaml';
import type { TrueNasClient } from './truenas/client.ts';

/** The compose document as TrueNAS stores it for a custom app. */
export type AppComposeConfig = Record<string, unknown>;

/** app.config — verified: [app_name]; not a job. */
export function appConfig(client: TrueNasClient, name: string): Promise<AppComposeConfig> {
	return client.call<AppComposeConfig>('app.config', [name]);
}

/**
 * The current compose as YAML text, ready for the editor. `services` is put
 * first because that's what anyone opening the file is looking for.
 */
export function configToYaml(config: AppComposeConfig): string {
	const ordered: AppComposeConfig = {};
	for (const key of ['services', 'networks', 'volumes', 'configs', 'secrets']) {
		if (config[key] !== undefined) ordered[key] = config[key];
	}
	for (const [key, value] of Object.entries(config)) {
		if (ordered[key] === undefined) ordered[key] = value;
	}
	return stringify(ordered, { lineWidth: 0, indent: 2 });
}

/**
 * app.update — verified: (app_name, {values, custom_compose_config,
 * custom_compose_config_string}); a job, and it redeploys the app.
 */
export function updateCustomApp(client: TrueNasClient, name: string, composeYaml: string) {
	return client.callJob('app.update', [name, { custom_compose_config_string: composeYaml }]);
}
