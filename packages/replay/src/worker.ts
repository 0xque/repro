import { readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { z } from 'zod';
import { startApp } from '../../../examples/checkout/src/app.js';
import { placeOrder as bad } from '../../../examples/checkout/src/bad.js';
import { placeOrder as fixed } from '../../../examples/checkout/src/fixed.js';
import { installHttpPolicy } from '../../adapter-http/src/index.js';
import { startDatabase } from '../../adapter-postgres/src/index.js';
import { ActionDivergence, captureBrowser, executeAction } from '../../record-browser/src/index.js';
import { captureSummarySchema, chromiumVersion, httpSchema, limits, oracleSchema, origin, parseEvents, parseJson, postgresSchema } from '../../schema/src/index.js';
import { verdict } from './result.js';
import type { RunResult } from './result.js';

const inputSchema = z.strictObject({
  mode: z.enum(['record', 'play', 'verify']), variant: z.enum(['bad', 'fixed']),
  postgres: postgresSchema, http: httpSchema, oracle: oracleSchema,
  timeline: z.string().max(limits.entry).optional(),
  guided: z.boolean()
});

async function checkNetwork() {
  const interfaces = await readdir('/sys/class/net');
  if (interfaces.length !== 1 || interfaces[0] !== 'lo') throw new Error('Non-loopback interface');
  await new Promise<void>((resolve, reject) => {
    const connection = createConnection({ host: '192.0.2.1', port: 443, timeout: 500 });
    connection.on('connect', () => { connection.destroy(); reject(new Error('Unexpected egress')); });
    connection.on('timeout', () => { connection.destroy(); reject(new Error('Egress test timed out')); });
    connection.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENETUNREACH') resolve();
      else reject(new Error('Egress denial could not be verified'));
    });
  });
}

async function run(input: z.infer<typeof inputSchema>, next: () => Promise<IteratorResult<string>>) {
  const start = performance.now();
  const result: RunResult = {
    status: 'ERROR', phase: 'prepare', events: [], network: 'unverified', duration_ms: 0,
    actual: { orders: null, checkout_complete: false, matched_http: 0, unmatched_http: 0, checkout_requests: 0, page_errors: 0 }
  };
  let database: Awaited<ReturnType<typeof startDatabase>> | undefined;
  let closeApp: (() => Promise<void>) | undefined;
  let browser: Browser | undefined;
  let counts: Awaited<ReturnType<typeof installHttpPolicy>> | undefined;
  try {
    if (process.getuid?.() !== 1001) throw new Error('Invalid execution identity');
    await checkNetwork();
    result.network = 'loopback-only';
    result.phase = 'restore';
    database = await startDatabase(input.postgres);
    closeApp = await startApp(database.app, input.variant === 'bad' ? bad : fixed);
    result.phase = 'healthcheck';
    const health = await fetch(origin + '/health', { signal: AbortSignal.timeout(2_000) });
    if (await health.text() !== 'ok') throw new Error('Application health check failed');
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-background-networking', '--disable-quic', '--no-proxy-server']
    });
    if (browser.version() !== chromiumVersion) throw new Error('Browser version mismatch');
    const context = await browser.newContext({
      locale: 'en-US', timezoneId: 'UTC', viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block', acceptDownloads: false
    });
    counts = await installHttpPolicy(context, input.http);
    const page = await context.newPage();
    const opened = new Set<PageIdentity>();
    context.on('page', (popup) => { opened.add(popup); void popup.close().catch(() => {}); });
    page.on('pageerror', () => { result.actual.page_errors++; });
    result.phase = 'execute';

    const capture = input.mode === 'record' ? await captureBrowser(context, page, input.guided ? async (action) => {
      const label = 'test_id' in action ? action.test_id : action.kind;
      process.stderr.write('Recording ' + action.kind + ' (' + label + '). Press Enter to continue.\n');
      const line = await next();
      if (line.done || line.value.trim() !== '') throw new Error('Recording cancelled');
    } : undefined) : undefined;
    if (!capture) {
      if (!input.timeline) throw new Error('Timeline missing');
      for (const event of parseEvents(Buffer.from(input.timeline))) {
        if (event.kind === 'failure') continue;
        try {
          await executeAction(page, event);
          result.events.push({ seq: event.seq, status: 'matched' });
        } catch (error) {
          result.events.push({ seq: event.seq, status: 'diverged' });
          result.status = 'DIVERGED';
          result.detail = error instanceof ActionDivergence ? error.message : 'Action could not complete';
          return result;
        }
      }
    }

    result.phase = 'assert';
    const confirmation = page.getByTestId(input.oracle.success.test_id);
    result.actual.checkout_complete = await confirmation.count() === 1 &&
      await confirmation.isVisible() && await confirmation.textContent({ timeout: 1_000 }) === input.oracle.success.text;
    result.actual.orders = await database.count();
    result.actual.matched_http = counts.matched;
    result.actual.unmatched_http = counts.unmatched + opened.size;
    result.actual.checkout_requests = counts.checkout;
    result.status = verdict(input.mode, result.actual);
    if (capture && result.status === 'CAPTURED') {
      await capture.markFailure();
      result.capture = { events: capture.events, summary: captureSummarySchema.parse({
        actions: capture.events.length - 1, observed_orders: result.actual.orders,
        checkout_complete: result.actual.checkout_complete, matched_http: counts.matched
      }) };
      result.events = capture.events.filter((event) => event.kind !== 'failure').map(({ seq }) => ({ seq, status: 'matched' }));
    }
    result.phase = 'report';
    return result;
  } catch {
    result.status = result.phase === 'prepare' ? 'BLOCKED' : result.phase === 'execute' ? 'DIVERGED' : 'INCONCLUSIVE';
    result.detail = 'Runner could not complete phase ' + result.phase;
    return result;
  } finally {
    if (counts) {
      result.actual.matched_http = counts.matched;
      result.actual.unmatched_http = Math.max(counts.unmatched, result.actual.unmatched_http);
      result.actual.checkout_requests = counts.checkout;
    }
    try {
      await browser?.close();
      await closeApp?.();
      await database?.close();
    } catch {
      result.status = 'ERROR';
      result.phase = 'cleanup';
      result.detail = 'Runner process cleanup failed';
      delete result.capture;
    }
    result.duration_ms = Math.round(performance.now() - start);
  }
}

type PageIdentity = Awaited<ReturnType<Browser['newPage']>>;

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
try {
  const first = await iterator.next();
  if (first.done) throw new Error('Missing runner input');
  const result = await run(inputSchema.parse(parseJson(Buffer.from(first.value))), () => iterator.next());
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write('Invalid runner input\n');
  process.exitCode = 8;
} finally {
  lines.close();
}
