import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobRegistry, JobError, isTerminalState } from '../src/lib/server/truenas/jobs.ts';

test('terminal-state helper', () => {
	assert.equal(isTerminalState('SUCCESS'), true);
	assert.equal(isTerminalState('FAILED'), true);
	assert.equal(isTerminalState('ABORTED'), true);
	assert.equal(isTerminalState('RUNNING'), false);
	assert.equal(isTerminalState('WAITING'), false);
});

test('normal path: register, progress, then SUCCESS resolves', async () => {
	const reg = new JobRegistry();
	const seen: number[] = [];
	const done = reg.register(1, { method: 'app.start', onProgress: (j) => seen.push(j.progress?.percent ?? -1) });

	reg.ingest({ id: 1, state: 'RUNNING', progress: { percent: 25, description: 'pulling' } });
	reg.ingest({ id: 1, state: 'RUNNING', progress: { percent: 80, description: 'starting' } });
	reg.ingest({ id: 1, state: 'SUCCESS', progress: { percent: 100 }, result: null });

	const job = await done;
	assert.equal(job.state, 'SUCCESS');
	assert.deepEqual(seen, [25, 80, 100]);
});

test('failure path: FAILED rejects with JobError carrying detail', async () => {
	const reg = new JobRegistry();
	const done = reg.register(2, { method: 'app.stop' });
	reg.ingest({ id: 2, state: 'FAILED', error: 'container refused to stop' });

	await assert.rejects(done, (err: unknown) => {
		assert.ok(err instanceof JobError);
		assert.equal(err.job.state, 'FAILED');
		assert.match(err.message, /container refused to stop/);
		return true;
	});
});

test('the race: an event that arrives before register still settles the job', async () => {
	const reg = new JobRegistry();
	// The core.get_jobs "added"/terminal event lands before the app.start call
	// has returned the id, so nobody is registered yet.
	reg.ingest({ id: 3, state: 'RUNNING', progress: { percent: 40 } });
	reg.ingest({ id: 3, state: 'SUCCESS', progress: { percent: 100 }, result: 'ok' });

	// Only now does the caller learn the id and register interest.
	const job = await reg.register(3, { method: 'app.start' });
	assert.equal(job.state, 'SUCCESS');
	assert.equal(job.result, 'ok');
});

test('registering twice for one id yields the same promise', () => {
	const reg = new JobRegistry();
	const a = reg.register(4);
	const b = reg.register(4);
	assert.equal(a, b);
});

test('pendingIds reflects unsettled jobs and clears on completion', async () => {
	const reg = new JobRegistry();
	const done = reg.register(5);
	assert.deepEqual(reg.pendingIds(), [5]);
	reg.ingest({ id: 5, state: 'SUCCESS' });
	await done;
	assert.deepEqual(reg.pendingIds(), []);
});

test('recent-snapshot buffer is bounded: evicted snapshots are dropped', async () => {
	const reg = new JobRegistry(4);
	// A terminal snapshot for job 999 lands with nobody registered, so it is
	// buffered. Then a flood of other job ids from the box evicts it.
	reg.ingest({ id: 999, state: 'SUCCESS', result: 'early' });
	for (let id = 1; id <= 10; id++) reg.ingest({ id, state: 'RUNNING' });

	// Registering 999 now finds no buffered snapshot, so it stays pending. Were
	// the buffer unbounded, the retained SUCCESS would have settled it instead.
	reg.register(999);
	await Promise.resolve(); // allow any buffered drain microtask to run
	assert.equal(reg.pendingIds().includes(999), true);
});
