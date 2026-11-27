import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  await mkdir(join(dir, 'assets'));
  for (const name of ['bodoni-moda-520-display-a4fd542b.ttf', 'BodoniModa-OFL.txt']) {
    await copyFile(new URL('./assets/' + name, import.meta.url), join(dir, 'assets', name));
  }
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

test('endmark is same-origin text and the Worker serves the exact pinned font and license', async () => {
  const { default:worker } = await import('./worker.mjs');
  const origin = 'https://repro.querencia.art';
  const path = '/assets/bodoni-moda-520-display-a4fd542b.ttf';
  const document = worker.fetch(new Request(origin));
  assert.match(document.headers.get('content-security-policy'), /font-src 'self'/);
  const html = await document.text();
  assert.match(html, /<div id="repro-endmark" class="repro-endmark"><span>REPRO<\/span><\/div>/);
  assert.match(html, /unicode-range:U\+0045,U\+004F-0050,U\+0052/);
  assert.match(html, /src:url\("\/assets\/bodoni-moda-520-display-a4fd542b.ttf"\)/);
  assert.doesNotMatch(html, /font\/woff2;base64|Harmond|ENDMARK_LICENSED/);
  const font = worker.fetch(new Request(origin+path));
  assert.equal(font.headers.get('content-type'), 'font/ttf');
  assert.match(font.headers.get('cache-control'), /immutable/);
  assert.equal(createHash('sha256').update(Buffer.from(await font.arrayBuffer())).digest('hex'),
    'a4fd542b56511b7e722a354ff31229e6203c818b1016da46a8f49c8addcbba7a');
  const head = worker.fetch(new Request(origin+path, { method:'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(worker.fetch(new Request(origin+path, { method:'POST' })).status,405);
  assert.equal(worker.fetch(new Request(origin+'/assets/unknown')).status,404);
  const notice = worker.fetch(new Request(origin+'/assets/BodoniModa-OFL.txt'));
  assert.equal(notice.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await notice.text(),await readFile(new URL('./assets/BodoniModa-OFL.txt',import.meta.url),'utf8'));
});
