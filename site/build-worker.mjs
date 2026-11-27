import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// HTML parsing folds CRLF and standalone CR into LF before CSP examines inline text.
const html = (await readFile(new URL('./index.html',import.meta.url),'utf8')).replace(/\r\n?/g, '\n');
const digest = (value) => createHash('sha256').update(value).digest('base64');
const [style, script] = ['style','script'].map(tag => html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1]);
if (!style || !script) throw new Error('Missing single inline stylesheet or script');
const csp = "default-src 'none'; style-src 'sha256-"+digest(style)+"'; script-src 'sha256-"+digest(script)+"'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
await writeFile(new URL('./worker.mjs',import.meta.url),`const page = ${JSON.stringify(html)};
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
