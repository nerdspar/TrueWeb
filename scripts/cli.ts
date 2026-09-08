/**
 * TrueWeb M1 test harness.
 *
 * Exercises the client layer from the command line — no UI. Run with:
 *
 *   npm run cli -- <command> [args]
 *
 * Commands:
 *   me                     authenticate and print auth.me
 *   apps                   list apps with their state
 *   start <app>            start an app, printing live job progress
 *   stop <app>             stop an app, printing live job progress
 *   redeploy <app>         restart an app, printing live job progress
 *   watch-apps             subscribe to app.query and stream state changes
 *   watch-jobs             subscribe to core.get_jobs and stream progress
 *
 * watch-* run until Ctrl-C, and are also the reconnect demo: kill the network,
 * restore it, and the client re-authenticates and re-subscribes on its own.
 *
 * Config comes from the environment (see .env.example). Load a .env with:
 *   node --env-file=.env --import tsx scripts/cli.ts <command>
 * or export the vars yourself.
 */
import { loadConfig } from '../src/lib/server/truenas/env.ts';
import { TrueNasClient } from '../src/lib/server/truenas/client.ts';
import { makeLogger } from '../src/lib/server/truenas/log.ts';
import * as api from '../src/lib/server/truenas/methods.ts';
import type { Job } from '../src/lib/server/truenas/jobs.ts';
import type { CollectionUpdate } from '../src/lib/server/truenas/protocol.ts';

const USAGE = `TrueWeb M1 harness
Usage: npm run cli -- <command> [args]

  me                 authenticate and print auth.me
  apps               list apps with their state
  start <app>        start an app (live job progress)
  stop <app>         stop an app (live job progress)
  redeploy <app>     restart an app (live job progress)
  watch-apps         stream live app.query state changes (Ctrl-C to stop)
  watch-jobs         stream live core.get_jobs progress (Ctrl-C to stop)
`;

function progressPrinter(label: string): (job: Job) => void {
	let last = '';
	return (job) => {
		const pct = job.progress?.percent ?? 0;
		const desc = job.progress?.description ?? '';
		const line = `${label}  [${job.state}] ${pct}%  ${desc}`.trimEnd();
		if (line !== last) {
			console.log(line);
			last = line;
		}
	};
}

function waitForSigint(): Promise<void> {
	return new Promise((resolve) => {
		process.on('SIGINT', () => {
			console.log('\n(interrupted)');
			resolve();
		});
	});
}

async function runJob(
	label: string,
	call: Promise<{ id: number; done: Promise<Job> }>
): Promise<void> {
	const { id, done } = await call;
	console.log(`${label} → job ${id}`);
	const job = await done;
	console.log(`${label} → ${job.state}`);
}

async function main(): Promise<number> {
	const [command, ...rest] = process.argv.slice(2);
	if (!command || command === 'help' || command === '--help') {
		console.log(USAGE);
		return command ? 0 : 1;
	}

	const client = new TrueNasClient(loadConfig(), makeLogger('trueweb'));
	const me = await client.connect();

	try {
		switch (command) {
			case 'me': {
				console.log(JSON.stringify(me, null, 2));
				return 0;
			}
			case 'apps': {
				const apps = await api.listApps(client);
				if (apps.length === 0) {
					console.log('(no apps)');
					break;
				}
				const width = Math.max(...apps.map((a) => a.name.length));
				for (const a of apps) {
					const upd = a.upgrade_available ? '  ⬆ update' : '';
					console.log(
						`${a.name.padEnd(width)}  ${a.state.padEnd(9)}  ${a.human_version ?? ''}${upd}`
					);
				}
				return 0;
			}
			case 'start':
				await runJob(`start ${arg(rest)}`, api.startApp(client, arg(rest), progressPrinter('  start')));
				return 0;
			case 'stop':
				await runJob(`stop ${arg(rest)}`, api.stopApp(client, arg(rest), progressPrinter('  stop')));
				return 0;
			case 'redeploy':
				await runJob(
					`redeploy ${arg(rest)}`,
					api.redeployApp(client, arg(rest), progressPrinter('  redeploy'))
				);
				return 0;
			case 'watch-apps': {
				api.watchApps(client, (u: CollectionUpdate) => {
					const rec = (u.fields ?? {}) as { name?: string; state?: string };
					console.log(`app.query ${u.msg}  ${rec.name ?? u.id ?? ''}  ${rec.state ?? ''}`.trimEnd());
				});
				console.log('watching app.query — Ctrl-C to stop');
				await waitForSigint();
				return 0;
			}
			case 'watch-jobs': {
				api.watchJobs(client, (u: CollectionUpdate) => {
					const j = (u.fields ?? {}) as Partial<Job>;
					console.log(
						`core.get_jobs ${u.msg}  #${j.id ?? u.id}  ${j.method ?? ''}  [${j.state ?? '?'}] ${j.progress?.percent ?? 0}%`
					);
				});
				console.log('watching core.get_jobs — Ctrl-C to stop');
				await waitForSigint();
				return 0;
			}
			default:
				console.error(`unknown command: ${command}\n`);
				console.log(USAGE);
				return 1;
		}
		return 0;
	} finally {
		await client.close();
	}
}

function arg(rest: string[]): string {
	const v = rest[0];
	if (!v) {
		throw new Error('this command requires an app name, e.g. `npm run cli -- start plex`');
	}
	return v;
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error(`error: ${err?.message ?? err}`);
		process.exit(1);
	});
