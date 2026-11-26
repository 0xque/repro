import { z } from 'zod';
import {
  captureSummarySchema, digest, eventSchema, files, httpFixture, json, limits, oracle,
  parseEvents, postgresFixture, uuid
} from '../../schema/src/index.js';

const selectors = new Set(['add-product', 'order-label', 'place-order', 'confirmation']);

export const draftSchema = z.strictObject({
  id: uuid, created_at: z.iso.datetime(), source_revision: digest, recipe_digest: digest,
  events: z.array(eventSchema).min(2).max(limits.events),
  summary: captureSummarySchema
});
export type Draft = z.infer<typeof draftSchema>;

export const excluded = [
  'Request headers and cookies', 'Raw HTTP bodies and full URLs', 'Non-synthetic form values',
  'Database rows and credentials', 'Console message text', 'Screenshots, traces and browser profiles'
];

export function sanitizedFiles(unreviewed: unknown) {
  const draft = draftSchema.parse(unreviewed);
  const timeline = Buffer.concat(draft.events.map(json));
  const events = parseEvents(timeline);
  for (const event of events) {
    if ('test_id' in event && !selectors.has(event.test_id)) throw new Error('Selector is outside the reviewed export policy');
  }
  if (draft.summary.actions !== events.length - 1) throw new Error('Capture summary differs from timeline');
  return new Map([
    [files.events, timeline], [files.oracle, json(oracle)], [files.postgres, json(postgresFixture)],
    [files.http, json(httpFixture)], [files.summary, json(draft.summary)]
  ]);
}
