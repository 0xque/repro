import { randomUUID } from 'node:crypto';
import { demoActions } from '../packages/record-browser/src/index.js';
import type { Draft } from '../packages/redaction/src/index.js';
import { chromiumRevision, eventSchema, files } from '../packages/schema/src/index.js';
import type { Manifest } from '../packages/schema/src/index.js';

export function fixture() {
  const draft: Draft = {
    id: randomUUID(), created_at: new Date().toISOString(), source_revision: 'a'.repeat(64), recipe_digest: 'b'.repeat(64),
    events: [...demoActions, { kind: 'failure', oracle: 'order-count' }].map((step, index) => eventSchema.parse({
      ...step, seq: index + 1, page: 'main', t_us: index * 350, timeout_ms: 5_000
    })),
    summary: { actions: 5, observed_orders: 2, checkout_complete: true, matched_http: 1 }
  };
  const manifest: Omit<Manifest, 'attachments'> = {
    schema_version: '1.0.0', capsule_id: draft.id, created_at: draft.created_at, title: 'Checkout duplicates order',
    target: { recipe_id: 'checkout-v1', recipe_digest: draft.recipe_digest, source_revision: draft.source_revision,
      framework: 'node', browser: 'chromium', browser_revision: chromiumRevision, locale: 'en-US', timezone: 'UTC', viewport: [1280, 800] },
    required_capabilities: ['browser.chromium', 'postgres.fixture.v1', 'http.fixture.v1'],
    network_policy: 'external-deny',
    reproducibility: { grade: 'fixture-backed', known_gaps: ['Checkout fixture only; main frame and test IDs only'] },
    privacy: { policy_version: '1', reviewed: true, contains_raw_capture: false }, oracle: { path: files.oracle, version: 1 }
  };
  return { draft, manifest };
}
