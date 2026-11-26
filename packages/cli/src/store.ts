import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { draftSchema, sanitizedFiles } from '../../redaction/src/index.js';
import type { Draft } from '../../redaction/src/index.js';
import { digest, json, limits, parseJson, sha256, uuid } from '../../schema/src/index.js';

const receiptSchema = z.strictObject({ policy: z.literal('1'), digest });

function retentionMs(): number {
  const hours = Number(process.env.REPRO_RETENTION_HOURS ?? '24');
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 168) throw new Error('Retention must be 1–168 hours');
  return hours * 3_600_000;
}

export async function privateStore(project: string) {
  const root = join(await realpath(project), '.repro');
  await mkdir(root, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) {
    throw new Error('Session directory must be owned and private');
  }
  return root;
}

function pathFor(root: string, id: string, suffix: 'draft' | 'review') {
  return join(root, uuid.parse(id) + '.' + suffix + '.json');
}

async function readPrivate(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > limits.entry) {
      throw new Error('Session file must be owned, bounded and private');
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size || (await handle.stat()).size !== stat.size) throw new Error('Session file changed while reading');
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function saveDraft(root: string, draft: Draft) {
  sanitizedFiles(draft);
  await writeFile(pathFor(root, draft.id, 'draft'), json(draft), { flag: 'wx', mode: 0o600 });
}

export async function readDraft(root: string, id: string) {
  const bytes = await readPrivate(pathFor(root, id, 'draft'));
  const draft = draftSchema.parse(parseJson(bytes));
  const age = Date.now() - Date.parse(draft.created_at);
  if (draft.id !== id || age < 0 || age >= retentionMs()) throw new Error('Session is invalid or expired');
  return { draft, hash: sha256(bytes), files: sanitizedFiles(draft) };
}

export async function approveDraft(root: string, id: string, hash: string) {
  const path = pathFor(root, id, 'review');
  const receipt = receiptSchema.parse({ policy: '1', digest: hash });
  await writeFile(path, json(receipt), { flag: 'wx', mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
    const current = receiptSchema.parse(parseJson(await readPrivate(path)));
    if (current.digest !== hash) throw new Error('Session was changed after approval');
  });
}

export async function requireApproval(root: string, id: string, hash: string) {
  const receipt = receiptSchema.parse(parseJson(await readPrivate(pathFor(root, id, 'review'))));
  if (receipt.digest !== hash) throw new Error('Session was changed after approval');
}

export async function purgeDrafts(root: string, id?: string) {
  async function purge(session: string) {
    await removeIfPresent(pathFor(root, session, 'review'));
    await removeIfPresent(pathFor(root, session, 'draft'));
  }

  if (id) {
    await purge(id);
    return 1;
  }
  let count = 0;
  const cutoff = Date.now() - retentionMs();
  for (const entry of await readdir(root)) {
    const match = /^([a-f0-9-]+)\.(draft\.json|active|stop)$/.exec(entry);
    if (!match?.[1] || !uuid.safeParse(match[1]).success) continue;
    const path = join(root, entry);
    const stat = await lstat(path).catch(() => undefined);
    if (!stat?.isFile() || stat.uid !== process.getuid?.()) continue;
    if (match[2] === 'draft.json' && stat.mtimeMs <= cutoff) {
      await purge(match[1]);
      count++;
    } else if (match[2] !== 'draft.json' && Date.now() - stat.mtimeMs > guidedDurationMs + 30_000) {
      await removeIfPresent(path);
    }
  }
  return count;
}

const guidedDurationMs = 300_000;

function controlPath(root: string, id: string, type: 'active' | 'stop') {
  return join(root, uuid.parse(id) + '.' + type);
}

async function removeIfPresent(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function startRecordingControl(root: string, id: string) {
  const active = controlPath(root, id, 'active');
  const stop = controlPath(root, id, 'stop');
  await writeFile(active, '', { flag: 'wx', mode: 0o600 });
  return {
    async requested() {
      try {
        await readPrivate(stop);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    async close() {
      await removeIfPresent(active);
      await removeIfPresent(stop);
    }
  };
}

export async function requestStop(root: string, id?: string) {
  const names = id ? [id + '.active'] : (await readdir(root)).filter((entry) => entry.endsWith('.active'));
  const active = [];
  for (const name of names) {
    const session = name.slice(0, -'.active'.length);
    if (!uuid.safeParse(session).success) continue;
    const stat = await lstat(controlPath(root, session, 'active')).catch(() => undefined);
    if (stat?.isFile() && stat.uid === process.getuid?.() && !(stat.mode & 0o077) &&
        Date.now() - stat.mtimeMs <= guidedDurationMs + 5_000) active.push(session);
  }
  if (active.length !== 1 || !active[0]) throw new Error('Expected one active guided session');
  await writeFile(controlPath(root, active[0], 'stop'), '', { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return active[0];
}
