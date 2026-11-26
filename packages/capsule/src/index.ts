import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import yazl from 'yazl';
import {
  attachmentPath, captureSummarySchema, files, httpSchema, limits, manifestSchema,
  oracleSchema, parseEvents, parseJson, postgresSchema, requiredFiles, sha256, json
} from '../../schema/src/index.js';
import type { Manifest } from '../../schema/src/index.js';

const manifestPath = 'manifest.json';

function validPath(path: string): boolean {
  return path === manifestPath || requiredFiles.some((file) => file === path) || attachmentPath.safeParse(path).success;
}

function openArchive(fd: number): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromFd(fd, { lazyEntries: true, autoClose: false, strictFileNames: true }, (error, archive) => {
      if (error || !archive) reject(error ?? new Error('Unable to read ZIP'));
      else resolve(archive);
    });
  });
}

async function collect(zip: ZipFile, entry: Entry, remaining: number): Promise<Buffer> {
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zip.openReadStream(entry, (error, result) => {
      if (error || !result) reject(error ?? new Error('Unable to read ZIP entry'));
      else resolve(result);
    });
  });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > Math.min(remaining, limits.entry, entry.uncompressedSize)) throw new Error('ZIP exceeds inflation limit');
    chunks.push(buffer);
  }
  if (size !== entry.uncompressedSize) throw new Error('ZIP size mismatch');
  const bytes = Buffer.concat(chunks, size);
  if (crc32(bytes) !== entry.crc32) throw new Error('ZIP checksum mismatch');
  return bytes;
}

async function archiveFiles(path: string): Promise<Map<string, Buffer>> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limits.archive) throw new Error('Invalid archive file or size');
    if (stat.size < 42) throw new Error('Truncated ZIP');
    const footer = Buffer.alloc(42);
    if ((await handle.read(footer, 0, 42, stat.size - 42)).bytesRead !== 42 ||
        footer.readUInt32LE(20) !== 0x06054b50 || footer.readUInt32LE(0) === 0x07064b50 ||
        footer.readUInt32LE(24) !== 0 || footer.readUInt16LE(28) !== footer.readUInt16LE(30) ||
        footer.readUInt16LE(40) !== 0) {
      throw new Error('Unsupported ZIP footer, ZIP64, multi-disk archive or comment');
    }
    const directoryStart = footer.readUInt32LE(36);
    if (directoryStart + footer.readUInt32LE(32) !== stat.size - 22) throw new Error('Invalid ZIP central directory');
    const zip = await openArchive(handle.fd);
    if (zip.entryCount < requiredFiles.length + 1 || zip.entryCount > limits.entries) throw new Error('Invalid ZIP entry count');
    const entries = new Map<string, Buffer>();
    let total = 0;
    for (let index = 0; index < zip.entryCount; index++) {
      const next = once(zip, 'entry');
      zip.readEntry();
      const [entry] = await next as [Entry];
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (!validPath(entry.fileName) || entries.has(entry.fileName) || (type !== 0 && type !== 0o100000) ||
          (entry.externalFileAttributes & 0x10) || (entry.generalPurposeBitFlag & (1 | 64 | 8192)) ||
          ![0, 8].includes(entry.compressionMethod) ||
          entry.extraFields.some((field) => field.id === 1 || field.id === 0x7075)) {
        throw new Error('Unsupported path, duplicate or ZIP entry metadata');
      }
      if (entry.uncompressedSize > Math.min(limits.entry, limits.expanded - total)) throw new Error('ZIP exceeds inflation limit');
      const local = await zip.readLocalFileHeaderPromise(entry);
      if (!entry.fileNameRaw.equals(Buffer.from(entry.fileName)) || !local.fileName.equals(entry.fileNameRaw) ||
          local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
          local.fileDataStart + entry.compressedSize > directoryStart) {
        throw new Error('ZIP local and central entry metadata differ');
      }
      const bytes = await collect(zip, entry, limits.expanded - total);
      entries.set(entry.fileName, bytes);
      total += bytes.length;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

function validateContents(entries: Map<string, Buffer>) {
  function get(path: string): Buffer {
    const value = entries.get(path);
    if (!value) throw new Error('Missing declared entry');
    return value;
  }

  const manifest = manifestSchema.parse(parseJson(get(manifestPath)));
  if (entries.size !== manifest.attachments.length + 1) throw new Error('ZIP inventory differs from manifest');
  const declared = new Set<string>();
  for (const item of manifest.attachments) {
    if (declared.has(item.path)) throw new Error('Duplicate manifest entry');
    declared.add(item.path);
    const bytes = get(item.path);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256 ||
        (attachmentPath.safeParse(item.path).success && !item.path.endsWith(item.sha256))) {
      throw new Error('Capsule entry digest or length mismatch');
    }
  }
  if (requiredFiles.some((file) => !declared.has(file))) throw new Error('Missing mandatory declaration');

  const events = parseEvents(get(files.events));
  const oracle = oracleSchema.parse(parseJson(get(files.oracle)));
  const postgres = postgresSchema.parse(parseJson(get(files.postgres)));
  const http = httpSchema.parse(parseJson(get(files.http)));
  const summary = captureSummarySchema.parse(parseJson(get(files.summary)));
  if (summary.actions !== events.length - 1) throw new Error('Capture summary differs from timeline');
  return { manifest, events, oracle, postgres, http, summary, oracleDigest: sha256(get(files.oracle)) };
}

export type Capsule = ReturnType<typeof validateContents>;

export async function readCapsule(path: string): Promise<Capsule> {
  return validateContents(await archiveFiles(path));
}

export async function writeCapsule(path: string, manifest: Omit<Manifest, 'attachments'>, files: Map<string, Buffer>) {
  const attachments = [...files].map(([path, bytes]) => ({ path, sha256: sha256(bytes), bytes: bytes.length }));
  const entries = new Map([[manifestPath, json({ ...manifest, attachments })], ...files]);
  validateContents(entries);
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, { mode: 0o100600 });
  zip.end();
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await pipeline(zip.outputStream, handle.createWriteStream());
    await readCapsule(temporary);
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
}
