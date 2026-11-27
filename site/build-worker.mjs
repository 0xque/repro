import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// HTML parsing folds CRLF and standalone CR into LF before CSP examines inline text.
let html = (await readFile(new URL('./index.html',import.meta.url),'utf8')).replace(/\r\n?/g, '\n');
// The default build does not load a font or render the mark. Use this only with
// a self-hosting/identity license covering the supplied, unmodified WOFF2.
const endmarkFontPath = process.env.REPRO_ENDMARK_LICENSED_WOFF2;
let output = new URL('./worker.mjs', import.meta.url);
if (endmarkFontPath) {
  const font = await readFile(endmarkFontPath);
  if (font.length < 48 || font.toString('ascii', 0, 4) !== 'wOF2' || font.readUInt32BE(8) !== font.length) {
    throw new Error('REPRO_ENDMARK_LICENSED_WOFF2 must point to a valid WOFF2 file');
  }
  const face = '@font-face{font-family:"REPRO Endmark";font-style:normal;font-weight:600;font-display:block;src:url(data:font/woff2;base64,' +
    font.toString('base64') + ') format("woff2")}';
  const reveal = '\n;document.fonts?.load(\'600 1em "REPRO Endmark"\', "REPRO").then((faces) => { if (faces.length) document.getElementById("repro-endmark").hidden = false; }).catch(() => {});\n';
  if (!html.includes('id="repro-endmark"') || !html.includes('</style>') || !html.includes('</script>')) {
    throw new Error('The endmark requires its footer element and inline style and script');
  }
  html = html.replace('</style>', face + '\n</style>').replace('</script>', reveal + '</script>');
  const dir = new URL('./.build/', import.meta.url);
  await mkdir(dir, { recursive:true });
  output = new URL('worker-with-endmark.mjs', dir);
}
const digest = (value) => createHash('sha256').update(value).digest('base64');
const [style, script] = ['style','script'].map(tag => html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1]);
if (!style || !script) throw new Error('Missing single inline stylesheet or script');
const csp = "default-src 'none'; style-src 'sha256-"+digest(style)+"'; script-src 'sha256-"+digest(script)+"';" + (endmarkFontPath ? " font-src data:;" : "") + " img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
await writeFile(output,`const page = ${JSON.stringify(html)};
const headers = {
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"public, max-age=300",
  "Content-Security-Policy":${JSON.stringify(csp)},
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=()"
};
export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/favicon.ico") return new Response(null,{status:204});
    if (pathname !== "/") return new Response("Not found",{status:404});
    if (!["GET","HEAD"].includes(request.method)) return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
    return new Response(request.method === "HEAD" ? null : page, {headers});
  }
};\n`);
