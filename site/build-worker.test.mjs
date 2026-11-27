import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
