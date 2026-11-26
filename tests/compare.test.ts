import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCapsule } from '../packages/capsule/src/index.js';

const cli = fileURLToPath(new URL('../packages/cli/src/index.js', import.meta.url));
const archive = resolve('fixtures/capsules/checkout.repro');
const capsule = await readCapsule(archive);

function sample() {
  const captureRevision = capsule.manifest.target.source_revision;
  const shared = {
    capture_revision: captureRevision,
    recipe_digest: capsule.manifest.target.recipe_digest,
    oracle_sha256: capsule.oracleDigest,
    oracle: capsule.oracle,
    inventory: capsule.manifest.attachments,
    compatibility: capsule.manifest.reproducibility,
    phase: 'report',
    events: capsule.events.slice(0, -1).map(({ seq }) => ({ seq, status: 'matched' })),
    actual: { orders: 2, checkout_complete: true, matched_http: 1, unmatched_http: 0, checkout_requests: 1, page_errors: 0 },
    network: 'loopback-only',
    duration_ms: 48,
    cleanup: 'ok',
  };
  return {
    baseline: { ...shared, mode: 'play', revision: captureRevision, status: 'REPRODUCED' },
    candidate: {
      ...shared, mode: 'verify', revision: 'e'.repeat(64), status: 'FIX_VERIFIED', actual: { ...shared.actual, orders: 1 },
    },
  };
}

async function harness(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'repro-compare-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const left = join(dir, 'before.json');
  const right = join(dir, 'after.json');
  return {
    dir,
    right,
    async save(baseline: unknown, candidate: unknown) {
      await writeFile(left, JSON.stringify(baseline));
      await writeFile(right, JSON.stringify(candidate));
    },
    run(options = ['--json'], candidate = right) {
      return spawnSync(process.execPath, [cli, 'compare', archive, left, candidate, ...options], {
        encoding: 'utf8', cwd: dir, env: { PATH: dir }, timeout: 8_000,
      });
    },
  };
}

test('compares saved replay records without Docker; reports the order count delta in text and JSON', async (t) => {
  const fixture = await harness(t);
  const { baseline, candidate } = sample();
  await fixture.save(baseline, { ...candidate, inventory: candidate.inventory.toReversed() });
  const json = fixture.run();
  assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.equal(result.status, 'FIX_VERIFIED');
  assert.equal(result.executed, false);
  assert.equal(result.evidence, 'saved-reports-not-authenticated');
  assert.deepEqual(result.oracle, { name: 'order-count', expected: 1, baseline: 2, candidate: 1, delta: -1 });
  assert.deepEqual(result.candidate.timeline, { matched: candidate.events.length, expected: candidate.events.length, first_unmatched: null });
  const text = fixture.run([]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^FIX_VERIFIED ·/);
  assert.match(text.stdout, /Observed: 2 → 1 \(Δ -1\)/);
  assert.match(text.stdout, /No replay ran and the reports are not authenticated/);
});

test('points to the first explicit divergence, without confusing unrecorded actions with divergence', async (t) => {
  const fixture = await harness(t);
  const { baseline, candidate } = sample();
  await fixture.save(baseline, {
    ...candidate, status: 'DIVERGED', phase: 'execute',
    events: [{ seq: 1, status: 'matched' }, { seq: 2, status: 'diverged' }],
    actual: { ...candidate.actual, orders: null, checkout_complete: false },
  });
  const result = fixture.run();
  assert.equal(result.status, 5, result.stderr);
  const divergence = JSON.parse(result.stdout);
  const second = capsule.events[1]!;
  assert.deepEqual(divergence.candidate.timeline.first_unmatched, {
    sequence: 2, action: second.kind, ...('test_id' in second ? { test_id: second.test_id } : {}), state: 'diverged',
  });
  assert.equal(divergence.oracle.candidate, null);

  const { events: _, network: _network, duration_ms: _duration, actual: _actual, ...fields } = candidate;
  await fixture.save(baseline, { ...fields, phase: 'prepare', status: 'BLOCKED', cleanup: 'not-needed', detail: 'Preflight failed' });
  const blocked = fixture.run();
  assert.equal(blocked.status, 6, blocked.stderr);
  assert.deepEqual(JSON.parse(blocked.stdout).candidate.timeline.first_unmatched, {
    sequence: 1, action: 'navigate', state: 'not-recorded',
  });
});

test('only a reproduced baseline and complete distinct candidate can establish a fix', async (t) => {
  const fixture = await harness(t);
  const { baseline, candidate } = sample();
  await fixture.save(baseline, { ...candidate, status: 'STILL_FAILING', actual: baseline.actual });
  const failing = fixture.run();
  assert.equal(failing.status, 4, failing.stderr);
  assert.equal(JSON.parse(failing.stdout).status, 'STILL_FAILING');

  for (const invalid of [
    { ...candidate, revision: baseline.revision }, { ...candidate, cleanup: 'incomplete' },
    { ...candidate, network: 'unverified' }, { ...candidate, actual: baseline.actual },
    { ...candidate, events: candidate.events.slice(0, -1) },
  ]) {
    await fixture.save(baseline, invalid);
    const result = fixture.run();
    assert.equal(result.status, 6, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'INCONCLUSIVE');
  }
});

test('rejects unrelated evidence, invalid event order, symlinks and duplicate input keys', async (t) => {
  const fixture = await harness(t);
  const { baseline, candidate } = sample();
  for (const invalid of [
    { ...candidate, mode: 'play' },
    { ...candidate, recipe_digest: 'f'.repeat(64) },
    { ...candidate, inventory: candidate.inventory.map((entry, index) => index ? entry : { ...entry, sha256: 'f'.repeat(64) }) },
    { ...candidate, events: candidate.events.toReversed() },
  ]) {
    await fixture.save(baseline, invalid);
    const result = fixture.run();
    assert.equal(result.status, 8);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).status, 'ERROR');
  }

  await fixture.save(baseline, candidate);
  const link = join(fixture.dir, 'link.json');
  await symlink(fixture.right, link);
  assert.equal(fixture.run(['--json'], link).status, 8);
  await writeFile(fixture.right, JSON.stringify(candidate).replace('{', '{"mode":"play",'));
  const duplicate = fixture.run();
  assert.equal(duplicate.status, 8);
  assert.equal(duplicate.stdout, '');
});
