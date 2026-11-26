import { createHash } from 'node:crypto';
import { parseTree } from 'jsonc-parser';
import type { Node, ParseError } from 'jsonc-parser';
import { z } from 'zod';

export const limits = {
  archive: 8 * 1024 * 1024,
  expanded: 16 * 1024 * 1024,
  entry: 2 * 1024 * 1024,
  entries: 64,
  events: 1_000,
  record: 4_096,
  depth: 24
};

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function parseJson(input: Buffer): unknown {
  if (input.length > limits.entry) throw new Error('JSON exceeds size limit');
  const source = decoder.decode(input);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (++depth > limits.depth) throw new Error('JSON exceeds nesting limit');
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth < 0) throw new Error('Invalid JSON');
    }
  }
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, { disallowComments: true });
  if (!tree || errors.length) throw new Error('Invalid JSON');

  function check(node: Node) {
    if (node.type === 'number' && !Number.isFinite(node.value)) throw new Error('Nonfinite JSON number');
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as string;
        if (keys.has(key)) throw new Error('Duplicate JSON key');
        keys.add(key);
      }
    }
    if (node.type === 'array' && (node.children?.length ?? 0) > limits.events) throw new Error('JSON array exceeds item limit');
    for (const child of node.children ?? []) check(child);
  }

  check(tree);
  return JSON.parse(source);
}

export function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value) + '\n');
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const uuid = z.uuid();
export const origin = 'http://127.0.0.1:3000';
export const recipeId = 'checkout-v1';
export const playwrightVersion = '1.65.1';
export const chromiumRevision = '1255';
export const chromiumVersion = '159.0.8154.6';
const testId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const step = {
  seq: z.int().min(1).max(limits.events),
  t_us: z.int().min(0).max(3_600_000_000),
  page: z.literal('main'),
  timeout_ms: z.int().min(50).max(5_000)
};

export const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...step, kind: z.literal('navigate'), path: z.literal('/') }),
  z.strictObject({ ...step, kind: z.literal('click'), test_id: testId }),
  z.strictObject({ ...step, kind: z.literal('fill'), test_id: testId, value: z.literal('Sample label') }),
  z.strictObject({ ...step, kind: z.literal('wait'), test_id: testId }),
  z.strictObject({ ...step, kind: z.literal('failure'), oracle: z.literal('order-count') })
]);
export type Event = z.infer<typeof eventSchema>;

export const oracleSchema = z.strictObject({
  version: z.literal(1),
  failure: z.strictObject({ oracle: z.literal('order-count'), observe: z.literal(2), expected: z.literal(1) }),
  success: z.strictObject({ test_id: z.literal('confirmation'), text: z.literal('Checkout complete') })
});

export const postgresSchema = z.strictObject({
  version: z.literal(1),
  product: z.strictObject({ sku: z.literal('sample-kit'), price_cents: z.literal(1200) })
});

export const httpSchema = z.strictObject({
  version: z.literal(1),
  request: z.strictObject({ method: z.literal('GET'), url: z.literal('https://shipping.repro.test/quote') }),
  response: z.strictObject({ status: z.literal(200), cents: z.literal(250) })
});

export const oracle = oracleSchema.parse({
  version: 1, failure: { oracle: 'order-count', observe: 2, expected: 1 },
  success: { test_id: 'confirmation', text: 'Checkout complete' }
});
export const postgresFixture = postgresSchema.parse({
  version: 1, product: { sku: 'sample-kit', price_cents: 1200 }
});
export const httpFixture = httpSchema.parse({
  version: 1, request: { method: 'GET', url: 'https://shipping.repro.test/quote' },
  response: { status: 200, cents: 250 }
});

export const captureSummarySchema = z.strictObject({
  actions: z.int().min(1).max(limits.events - 1),
  observed_orders: z.literal(2),
  checkout_complete: z.literal(true),
  matched_http: z.literal(1)
});

export const files = {
  events: 'scenario/events.ndjson',
  oracle: 'scenario/assertions.json',
  postgres: 'fixtures/postgres.json',
  http: 'fixtures/http.json',
  summary: 'report/capture-summary.json'
} as const;
export const requiredFiles = Object.values(files);
export const attachmentPath = z.string().regex(/^attachments\/sha256\/[a-f0-9]{64}$/);

export const manifestSchema = z.strictObject({
  schema_version: z.literal('1.0.0'),
  capsule_id: uuid,
  title: z.literal('Checkout duplicates order'),
  created_at: z.iso.datetime(),
  target: z.strictObject({
    source_revision: digest, recipe_id: z.literal(recipeId), recipe_digest: digest,
    framework: z.literal('node'), browser: z.literal('chromium'), browser_revision: z.literal(chromiumRevision),
    locale: z.literal('en-US'), timezone: z.literal('UTC'), viewport: z.tuple([z.literal(1280), z.literal(800)])
  }),
  required_capabilities: z.tuple([z.literal('browser.chromium'), z.literal('postgres.fixture.v1'), z.literal('http.fixture.v1')]),
  network_policy: z.literal('external-deny'),
  reproducibility: z.strictObject({
    grade: z.literal('fixture-backed'),
    known_gaps: z.tuple([z.literal('Checkout fixture only; main frame and test IDs only')])
  }),
  privacy: z.strictObject({ policy_version: z.literal('1'), reviewed: z.literal(true), contains_raw_capture: z.literal(false) }),
  attachments: z.array(z.strictObject({
    path: z.union([z.enum(requiredFiles), attachmentPath]), sha256: digest, bytes: z.int().min(1).max(limits.entry)
  })).min(requiredFiles.length).max(limits.entries - 1),
  oracle: z.strictObject({ path: z.literal(files.oracle), version: z.literal(1) })
});

export function parseEvents(input: Buffer): Event[] {
  const lines = decoder.decode(input).split('\n');
  if (lines.pop() !== '' || lines.length < 2 || lines.length > limits.events) throw new Error('Invalid timeline length');
  let previousTime = 0;
  return lines.map((line, index) => {
    const record = Buffer.from(line);
    if (record.length > limits.record) throw new Error('Timeline record exceeds size limit');
    const event = eventSchema.parse(parseJson(record));
    if (event.seq !== index + 1 || event.t_us < previousTime) throw new Error('Invalid timeline order');
    if ((event.kind === 'failure') !== (index === lines.length - 1)) throw new Error('Expected exactly one final failure marker');
    if ((event.kind === 'navigate') !== (index === 0)) throw new Error('Expected exactly one initial navigation');
    previousTime = event.t_us;
    return event;
  });
}

export type Manifest = z.infer<typeof manifestSchema>;
export type CaptureSummary = z.infer<typeof captureSummarySchema>;
