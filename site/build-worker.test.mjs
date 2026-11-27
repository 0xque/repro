import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('Worker CSP matches inline content after browser newline normalization', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'repro-csp-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const html = '<!doctype html>\r\n<style>\r\nbody { color: black; }\r</style>\r\n' +
    '<script>\r\n/* MIT license\r\nCopyright holder\r*/\nwindow.loaded = true;\r\n</script>';
  await writeFile(join(dir, 'index.html'), html);
  const builder = join(dir, 'build-worker.mjs');
  await copyFile(new URL('./build-worker.mjs', import.meta.url), builder);
  execFileSync(process.execPath, [builder]);
  const { default:worker } = await import(pathToFileURL(join(dir, 'worker.mjs')));
  const response = worker.fetch(new Request('https://repro.querencia.art/'));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(!body.includes('\r'));
  assert.equal(body, html.replace(/\r\n?/g, '\n'));
  const csp = response.headers.get('content-security-policy');
  for (const tag of ['style', 'script']) {
    const text = body.split('<' + tag + '>')[1].split('</' + tag + '>')[0];
    const hash = createHash('sha256').update(text).digest('base64');
    assert.ok(csp.includes(tag + "-src 'sha256-" + hash + "'"));
  }
});

test('endmark is off by default and an opted-in font never writes the tracked Worker', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'repro-endmark-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const markup = '<style>.repro-endmark[hidden]{display:none}</style>' +
    '<div id="repro-endmark" class="repro-endmark" hidden aria-hidden="true"><span>REPRO</span></div>' +
    '<script>window.loaded = true;</script>';
  await writeFile(join(dir, 'index.html'), markup);
  const builder = join(dir, 'build-worker.mjs');
  await copyFile(new URL('./build-worker.mjs', import.meta.url), builder);
  const env = { ...process.env };
  delete env.REPRO_ENDMARK_LICENSED_WOFF2;
  execFileSync(process.execPath, [builder], { env });
  const standard = join(dir, 'worker.mjs');
  const original = await readFile(standard, 'utf8');
  const { default:worker } = await import(pathToFileURL(standard));
  const request = new Request('https://repro.querencia.art/');
  const response = worker.fetch(request);
  assert.equal(await response.text(), markup);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /font-src/);

  // Header-only test data for the builder opt-in, never used as a browser font.
  const font = Buffer.alloc(48);
  font.write('wOF2');
  font.writeUInt32BE(font.length, 8);
  const fontPath = join(dir, 'test-only.woff2');
  await writeFile(fontPath, font);
  env.REPRO_ENDMARK_LICENSED_WOFF2 = fontPath;
  execFileSync(process.execPath, [builder], { env });
  assert.equal(await readFile(standard, 'utf8'), original);
  const { default:enabled } = await import(pathToFileURL(join(dir, '.build', 'worker-with-endmark.mjs')));
  const built = enabled.fetch(request);
  const html = await built.text();
  for (const tag of ['style', 'script']) {
    const text = html.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))[1];
    assert.ok(built.headers.get('content-security-policy').includes(tag + "-src 'sha256-" +
      createHash('sha256').update(text).digest('base64') + "'"));
  }
  assert.match(built.headers.get('content-security-policy'), /font-src data:/);
  assert.match(html, /@font-face/);
  assert.match(html, /document\.fonts\?\.load/);
  assert.match(html, /id="repro-endmark" class="repro-endmark" hidden aria-hidden="true"/);
  assert.match(html, /data:font\/woff2;base64,/);
});
