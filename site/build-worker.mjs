import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// HTML parsing folds CRLF and standalone CR into LF before CSP examines inline text.
const html = (await readFile(new URL('./index.html',import.meta.url),'utf8')).replace(/\r\n?/g, '\n');
const fontName = 'bodoni-moda-520-display-a4fd542b.ttf';
const font = await readFile(new URL('./assets/' + fontName, import.meta.url));
const fontLicense = await readFile(new URL('./assets/BodoniModa-OFL.txt', import.meta.url), 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('base64');
const [style, script] = ['style','script'].map(tag => html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1]);
if (!style || !script) throw new Error('Missing single inline stylesheet or script');
const csp = "default-src 'none'; style-src 'sha256-"+digest(style)+"'; script-src 'sha256-"+digest(script)+"'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
await writeFile(new URL('./worker.mjs',import.meta.url),`const page = ${JSON.stringify(html)};
const typeface = Uint8Array.from(atob(${JSON.stringify(font.toString('base64'))}), c => c.charCodeAt(0));
const typefaceLicense = ${JSON.stringify(fontLicense)};
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
    const fontFile = pathname === "/assets/${fontName}";
    const licenseFile = pathname === "/assets/BodoniModa-OFL.txt";
    if (pathname !== "/" && !fontFile && !licenseFile) return new Response("Not found",{status:404});
    if (!["GET","HEAD"].includes(request.method)) return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
    const head = request.method === "HEAD";
    if (fontFile || licenseFile) return new Response(head ? null : fontFile ? typeface : typefaceLicense,{
      headers:{
        "Content-Type":fontFile ? "font/ttf" : "text/plain; charset=utf-8",
        "Cache-Control":fontFile ? "public, max-age=31536000, immutable" : "public, max-age=86400",
        "X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'",
      },
    });
    return new Response(head ? null : page, {headers});
  }
};\n`);
