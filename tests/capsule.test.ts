import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { writeCapsule, readCapsule } from '../packages/capsule/src/index.js';
import { approveDraft, privateStore, readDraft, requireApproval, saveDraft } from '../packages/cli/src/store.js';
import { sanitizedFiles } from '../packages/redaction/src/index.js';
import { parseRecipe, recipeDigest } from '../packages/replay/src/recipe.js';
import { verdict } from '../packages/replay/src/result.js';
import { files, json, limits, parseEvents, parseJson } from '../packages/schema/src/index.js';
import { fixture } from './fixture.js';

async function temp(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'repro-tests-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('strict JSON rejects duplicates, invalid bytes, nonfinite values and depth', () => {
  for (const source of [
    Buffer.from('{"a":1,"\\u0061":2}'), Buffer.from([0xc3]), Buffer.from('1e999'),
    Buffer.from('['.repeat(limits.depth + 1)), Buffer.from('{"a": 1,}'), Buffer.from('/* comment */ 42')
  ]) assert.throws(() => parseJson(source));
  assert.deepEqual(parseJson(Buffer.from('{"seen": [0, true]}')), { seen: [0, true] });
});

test('valid timeline preserves ordered typed events and rejects changed boundaries', () => {
  const { draft } = fixture();
  const buffer = (events: unknown[]) => Buffer.concat(events.map(json));
  assert.deepEqual(parseEvents(buffer(draft.events)), draft.events);
  assert.throws(() => parseEvents(buffer(draft.events.slice(0, -1))), /failure marker/);
  assert.throws(() => parseEvents(buffer(draft.events.toReversed())), /order/);
  assert.throws(() => parseEvents(buffer([{ ...draft.events[0], kind: 'script' }, ...draft.events.slice(1)])));
  assert.throws(() => parseEvents(buffer([{ ...draft.events[0], url: 'https://repro.test' }, ...draft.events.slice(1)])));
});

test('capsule round trips, remains private and refuses to replace output', async (t) => {
  const path = join(await temp(t), 'checkout.repro');
  const { draft, manifest } = fixture();
  const entries = sanitizedFiles(draft);
  await writeCapsule(path, manifest, entries);
  const read = await readCapsule(path);
  assert.deepEqual(read.events, draft.events);
  assert.equal(read.manifest.attachments.length, entries.size);
  assert.match(read.oracleDigest, /^[a-f0-9]{64}$/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(writeCapsule(path, manifest, entries), { code: 'EEXIST' });
  assert.equal((await readCapsule(path)).manifest.capsule_id, draft.id);
});

test('inspect summary validates offline, emits only aggregate metadata and preserves full inspection', async (t) => {
  const root = await temp(t);
  const path = join(root, 'checkout.repro');
  const { draft, manifest } = fixture();
  const entries = sanitizedFiles(draft);
  await writeCapsule(path, manifest, entries);
  const cli = fileURLToPath(new URL('../packages/cli/src/index.js', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: { PATH: root }, encoding: 'utf8', timeout: 5000,
  });
  const concise = run('inspect', path, '--summary', '--json');
  assert.equal(concise.status, 0, concise.stderr);
  assert.deepEqual(JSON.parse(concise.stdout), {
    schema_version: manifest.schema_version,
    validated: true,
    event_count: draft.events.length,
    entry_count: entries.size,
    declared_entry_bytes: [...entries.values()].reduce((sum, entry) => sum + entry.length, 0),
    executed: false,
  });
  const full = run('inspect', path, '--json');
  assert.equal(full.status, 0, full.stderr);
  const fullResult = JSON.parse(full.stdout);
  assert.deepEqual(fullResult.events, draft.events);
  assert.equal(fullResult.manifest.capsule_id, draft.id);
  assert.equal(fullResult.executed, false);

  const damaged = join(root, 'damaged.repro');
  await writeFile(damaged, (await readFile(path)).subarray(0, -1));
  const rejected = run('inspect', damaged, '--summary', '--json');
  assert.ok(rejected.status !== null && rejected.status !== 0);
  assert.equal(rejected.stdout, '');
  assert.equal(JSON.parse(rejected.stderr).status, 'ERROR');
});

test('capsule rejects unsupported versions, unknown fields and missing integrity declarations', async (t) => {
  const path = join(await temp(t), 'checkout.repro');
  const { draft, manifest } = fixture();
  const entries = sanitizedFiles(draft);
  await assert.rejects(writeCapsule(path, { ...manifest, schema_version: '2.0.0' } as unknown as typeof manifest, entries));
  const unknown = { ...manifest, commands: ['unexpected'] };
  await assert.rejects(writeCapsule(path, unknown, entries));
  entries.delete(files.oracle);
  await assert.rejects(writeCapsule(path, manifest, entries));
});

test('archive rejects malformed, local-name, duplicate and unsupported metadata', async (t) => {
  const root = await temp(t);
  const path = join(root, 'checkout.repro');
  const { draft, manifest } = fixture();
  await writeCapsule(path, manifest, sanitizedFiles(draft));
  const base = await readFile(path);
  const directory = base.readUInt32LE(base.length - 6);
  const positions: number[] = [];
  for (let entry = directory; entry < base.length - 22;) {
    positions.push(entry);
    entry += 46 + base.readUInt16LE(entry + 28) + base.readUInt16LE(entry + 30) + base.readUInt16LE(entry + 32);
  }
  assert.equal(positions.length, 6);

  const first = positions[0]!;
  const updates: Record<string, (bytes: Buffer) => void> = {
    'local-name': (bytes) => { bytes[30] = 'M'.charCodeAt(0); },
    'case': (bytes) => { bytes[first + 46] = 'M'.charCodeAt(0); },
    'bad-path': (bytes) => { bytes.write('../', first + 46, 'ascii'); },
    'duplicate': (bytes) => {
      const second = positions[1]!;
      const length = bytes.readUInt16LE(first + 28);
      bytes.writeUInt16LE(length, second + 28);
      bytes.copy(bytes, second + 46, first + 46, first + 46 + length);
    },
    'symlink': (bytes) => { bytes.writeUInt32LE(0o120777 * 65536, first + 38); },
    'encryption': (bytes) => { bytes.writeUInt16LE(bytes.readUInt16LE(first + 8) | 1, first + 8); },
    'compression': (bytes) => { bytes.writeUInt16LE(99, first + 10); },
    'expansion': (bytes) => { bytes.writeUInt32LE(limits.entry + 1, first + 24); },
    'checksum': (bytes) => { bytes.writeUInt32LE(0, first + 16); },
    'zip64-footer': (bytes) => { bytes.writeUInt32LE(0x07064b50, bytes.length - 42); }
  };
  for (const [name, update] of Object.entries(updates)) {
    const mutated = Buffer.from(base);
    update(mutated);
    const target = join(root, name + '.repro');
    await writeFile(target, mutated);
    await assert.rejects(readCapsule(target), Error, name);
  }
  await writeFile(join(root, 'broken.repro'), base.subarray(0, base.length - 1));
  await assert.rejects(readCapsule(join(root, 'broken.repro')));
  const indirect = join(root, 'indirect.repro');
  await symlink(path, indirect);
  await assert.rejects(readCapsule(indirect));
});

test('approved draft receipt is byte-bound and private', async (t) => {
  const root = await privateStore(await temp(t));
  const { draft } = fixture();
  await saveDraft(root, draft);
  const { hash } = await readDraft(root, draft.id);
  await assert.rejects(requireApproval(root, draft.id, hash));
  await approveDraft(root, draft.id, hash);
  await requireApproval(root, draft.id, hash);
  await assert.rejects(requireApproval(root, draft.id, 'e'.repeat(64)), /changed/);
  await chmod(root, 0o755);
  await assert.rejects(privateStore(join(root, '..')), /private/);
});

test('export policy refuses raw surfaces and free-text selectors or values', () => {
  const { draft } = fixture();
  for (const field of ['headers', 'url', 'body', 'database', 'console', 'screenshot', 'cookies']) {
    assert.throws(() => sanitizedFiles({ ...draft, [field]: 'synthetic-secret-example' }), field);
  }
  const events = structuredClone(draft.events);
  const fill = events[2];
  assert.equal(fill?.kind, 'fill');
  if (fill?.kind !== 'fill') throw new Error('Invalid test fixture');
  fill.test_id = 'private-selector';
  assert.throws(() => sanitizedFiles({ ...draft, events }), /export policy/);
  assert.throws(() => sanitizedFiles({ ...draft, events: (events as unknown[]).with(2, { ...fill, value: 'synthetic-secret-example' }) }));
  const contents = Buffer.concat([...sanitizedFiles(draft).values()]);
  assert.doesNotMatch(contents.toString(), /synthetic-secret-example|password|authorization/i);
});

test('recipe binds compatibility independent of locally selected image and variant', () => {
  const bad = parseRecipe(`recipe: checkout-v1\nimage: sha256:${'a'.repeat(64)}\nvariant: bad\nsource_revision: ${'b'.repeat(64)}\nrecipe_revision: ${'c'.repeat(64)}\n`);
  assert.equal(recipeDigest(bad), recipeDigest({ ...bad, image: 'sha256:' + 'd'.repeat(64), variant: 'fixed' }));
  assert.notEqual(recipeDigest(bad), recipeDigest({ ...bad, recipe_revision: 'e'.repeat(64) }));
  assert.throws(() => parseRecipe('recipe: checkout-v1\nrecipe: other\n'));
  assert.throws(() => parseRecipe('recipe: &value checkout-v1\nimage: *value\n'));
});

test('execution status requires a matched request, positive UI and exact row count', () => {
  const fixed = { orders: 1, checkout_complete: true, matched_http: 1, unmatched_http: 0, checkout_requests: 1, page_errors: 0 };
  assert.equal(verdict('verify', fixed), 'FIX_VERIFIED');
  assert.equal(verdict('verify', { ...fixed, checkout_complete: false }), 'INCONCLUSIVE');
  assert.equal(verdict('verify', { ...fixed, unmatched_http: 1 }), 'DIVERGED');
  assert.equal(verdict('verify', { ...fixed, orders: 0 }), 'INCONCLUSIVE');
  assert.equal(verdict('verify', { ...fixed, orders: 2 }), 'STILL_FAILING');
  assert.equal(verdict('play', { ...fixed, orders: 2 }), 'REPRODUCED');
});

test('archive rejects CRC-valid entries when the declared SHA-256 differs', async (t) => {
  const { default: yazl } = await import('yazl');
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream } = await import('node:fs');
  const { sha256 } = await import('../packages/schema/src/index.js');
  const path = join(await temp(t), 'hash-mismatch.repro');
  const { draft, manifest } = fixture();
  const entries = sanitizedFiles(draft);
  const attachments = [...entries].map(([path, bytes]) => ({
    path, sha256: path === files.oracle ? '0'.repeat(64) : sha256(bytes), bytes: bytes.length
  }));
  const zip = new yazl.ZipFile();
  zip.addBuffer(json({ ...manifest, attachments }), 'manifest.json');
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
  await assert.rejects(readCapsule(path), /digest or length mismatch/);
});

test('guided stop is bound to a live session and refuses ambiguity', async (t) => {
  const { startRecordingControl, requestStop } = await import('../packages/cli/src/store.js');
  const root = await privateStore(await temp(t));
  const firstId = fixture().draft.id;
  const secondId = fixture().draft.id;
  const first = await startRecordingControl(root, firstId);
  const second = await startRecordingControl(root, secondId);
  assert.equal(await first.requested(), false);
  await assert.rejects(requestStop(root), /one active/);
  assert.equal(await requestStop(root, firstId), firstId);
  assert.equal(await first.requested(), true);
  assert.equal(await second.requested(), false);
  await first.close();
  await assert.rejects(requestStop(root, firstId), /one active/);
  await second.close();
});

test('the recorded golden capsule opens without a browser or container', async () => {
  const capsule = await readCapsule('fixtures/capsules/checkout.repro');
  assert.equal(capsule.manifest.target.browser_revision, '1255');
  assert.equal(capsule.events.length, 6);
  assert.equal(capsule.events.at(-1)?.kind, 'failure');
  assert.equal(capsule.summary.observed_orders, 2);
  assert.equal(capsule.oracle.failure.expected, 1);
});
