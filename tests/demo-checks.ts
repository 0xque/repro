import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { readCapsule, writeCapsule } from '../packages/capsule/src/index.js';
import { runDocker } from '../packages/replay/src/docker.js';
import { loadRecipe } from '../packages/replay/src/recipe.js';
import { files, json } from '../packages/schema/src/index.js';

const exec = promisify(execFile);
const root = resolve(process.argv[2]!);
const bad = resolve(root, 'bad');
const fixed = resolve(root, 'fixed');
const capsulePath = resolve(root, 'checkout.repro');
const cli = resolve('dist/packages/cli/src/index.js');

async function read(name: string) {
  return JSON.parse(await readFile(resolve(root, name + '.json'), 'utf8'));
}

async function replay(mode: 'play' | 'verify', capsule: string, project: string, expectedExit: number) {
  const args = [cli, mode, capsule, '--project', project, '--offline', '--approve', '--json'];
  try {
    const { stdout } = await exec(process.execPath, args);
    assert.equal(expectedExit, 0);
    return JSON.parse(stdout);
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { stdout?: string };
    assert.equal(result.code, expectedExit);
    return JSON.parse(result.stdout ?? '');
  }
}

const [record, inspected, played, verified] = await Promise.all(['record', 'inspect', 'play', 'verify'].map(read));
assert.equal(record.status, 'CAPTURED');
assert.equal(inspected.executed, false);
assert.equal(inspected.events.length, 6);
assert.equal(played.status, 'REPRODUCED');
assert.equal(verified.status, 'FIX_VERIFIED');
assert.notEqual(played.revision, verified.revision);
assert.equal(played.oracle_sha256, verified.oracle_sha256);
for (const [result, orders] of [[played, 2], [verified, 1]] as const) {
  assert.deepEqual(result.actual, {
    orders, checkout_complete: true, matched_http: 1, unmatched_http: 0, checkout_requests: 1, page_errors: 0
  });
  assert.equal(result.events.length, 5);
  assert.ok(result.events.every((event: { status: string }) => event.status === 'matched'));
  assert.equal(result.network, 'loopback-only');
  assert.equal(result.cleanup, 'ok');
}
const { stdout: compared } = await exec(process.execPath, [
  cli, 'compare', capsulePath, resolve(root, 'play.json'), resolve(root, 'verify.json'), '--json'
]);
const comparison = JSON.parse(compared);
assert.equal(comparison.status, 'FIX_VERIFIED');
assert.equal(comparison.executed, false);
assert.deepEqual(comparison.oracle, { name: 'order-count', expected: 1, baseline: 2, candidate: 1, delta: -1 });
assert.equal((await stat(capsulePath)).mode & 0o777, 0o600);
console.log('Verified capture, offline inspection, replay and fix assertions.');

const stillFailing = await replay('verify', capsulePath, bad, 4);
assert.equal(stillFailing.status, 'STILL_FAILING');
assert.equal(stillFailing.actual.orders, 2);
assert.equal(stillFailing.cleanup, 'ok');
const blocked = await replay('play', capsulePath, fixed, 7);
assert.equal(blocked.status, 'BLOCKED');
assert.equal(blocked.cleanup, 'not-needed');

const capsule = await readCapsule(capsulePath);
const { attachments: _, ...manifest } = capsule.manifest;
const changed = capsule.events.map((event) => event.seq === 2 && event.kind === 'click'
  ? { ...event, test_id: 'missing-selector', timeout_ms: 500 } : event);
const divergent = resolve(root, 'divergent.repro');
await writeCapsule(divergent, manifest, new Map([
  [files.events, Buffer.concat(changed.map(json))], [files.oracle, json(capsule.oracle)],
  [files.postgres, json(capsule.postgres)], [files.http, json(capsule.http)], [files.summary, json(capsule.summary)]
]));
const divergence = await replay('verify', divergent, fixed, 5);
assert.equal(divergence.status, 'DIVERGED');
assert.deepEqual(divergence.events.at(-1), { seq: 2, status: 'diverged' });
assert.equal(divergence.cleanup, 'ok');
console.log('Negative checks: STILL_FAILING (4), BLOCKED revision mismatch (7), DIVERGED at action 2 (5).');

const recipe = await loadRecipe(bad);
const input = {
  mode: 'play', postgres: capsule.postgres, http: capsule.http, oracle: capsule.oracle, guided: false,
  timeline: Buffer.concat(changed.map((event) => json(event.seq === 2 ? { ...event, timeout_ms: 5_000 } : event))).toString('utf8')
} as const;
const timeout = await runDocker(recipe, input, new AbortController().signal, 2_000);
assert.equal(timeout.status, 'INCONCLUSIVE');
assert.equal(timeout.detail, 'Runner deadline exceeded');
assert.equal(timeout.cleanup, 'ok');

async function ownedContainers(pid: number, all = false) {
  const { stdout } = await exec('docker', ['--host', 'unix:///var/run/docker.sock', 'ps', all ? '--all' : '--filter=status=running', '--filter', 'label=repro.owner-pid=' + pid, '--format', '{{.Names}}'], {
    timeout: 2_000, env: { PATH: process.env.PATH }
  });
  return stdout.trim().split('\n').filter(Boolean);
}
const child = spawn(process.execPath, [cli, 'record', '--project', bad, '--url', 'http://127.0.0.1:3000',
  '--profile', 'checkout-demo', '--approve', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
const crashReport: Buffer[] = [];
child.stdout.on('data', (chunk: Buffer) => crashReport.push(chunk));
const childExit = new Promise<number | null>((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code) => resolve(code));
});
let name: string | undefined;
try {
  assert.ok(child.pid);
  for (let attempt = 0; attempt < 50 && !name; attempt++) {
    const candidates = await ownedContainers(child.pid);
    if (candidates.length === 1) name = candidates[0];
    else await sleep(40);
  }
  assert.ok(name, 'Expected one running demo container');
  await exec('docker', ['--host', 'unix:///var/run/docker.sock', 'kill', name], {
    timeout: 2_000, env: { PATH: process.env.PATH }
  });
  assert.equal(await childExit, 8);
  assert.equal(JSON.parse(Buffer.concat(crashReport).toString()).cleanup, 'ok');
  assert.ok(!(await ownedContainers(child.pid, true)).includes(name));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await childExit;
}
console.log('Timeout and forced worker termination both cleaned up their owned containers.');
