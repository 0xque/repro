import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const bundle = await build({
  absWorkingDir: dir,
  entryPoints: ['minimap-island.js'],
  outdir: 'generated',
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  legalComments: 'inline',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const notices = await Promise.all(['react', 'react-dom', 'scheduler', 'lenis'].map(async (name) =>
  name + ':\n' + (await readFile(new URL('./node_modules/' + name + '/LICENSE', import.meta.url), 'utf8')).trim()));
const page = new URL('./index.html', import.meta.url);
let html = await readFile(page, 'utf8');
for (const [kind, ext] of [['style', 'css'], ['script', 'js']]) {
  const built = bundle.outputFiles.find((file) => file.path.endsWith('.' + ext));
  if (!built) throw new Error('No minimap ' + ext + ' was built');
  const start = '/* BEGIN GENERATED MINIMAP ' + ext.toUpperCase() + ' */';
  const end = '/* END GENERATED MINIMAP ' + ext.toUpperCase() + ' */';
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b <= a || html.lastIndexOf(start) !== a || html.lastIndexOf(end) !== b) {
    throw new Error('Missing or ambiguous minimap bundle markers');
  }
  const raw = built.text.replace(new RegExp('</' + kind, 'gi'), (value) => value.replace('/', '\\/'));
  html = html.slice(0, a + start.length) + '\n' + raw.trimEnd() + (ext === 'js' ? '\n/*! Third-party notices\n' + notices.join('\n\n') + '\n*/' : '') + '\n' + html.slice(b);
}
await writeFile(page, html);
