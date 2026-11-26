import { z } from 'zod';
import { captureSummarySchema, eventSchema, limits } from '../../schema/src/index.js';

export const resultSchema = z.strictObject({
  status: z.enum(['CAPTURED', 'REPRODUCED', 'NOT_REPRODUCED', 'FIX_VERIFIED', 'STILL_FAILING', 'DIVERGED', 'INCONCLUSIVE', 'BLOCKED', 'ERROR', 'CANCELLED']),
  phase: z.enum(['prepare', 'restore', 'healthcheck', 'execute', 'assert', 'report', 'cleanup']),
  events: z.array(z.strictObject({ seq: z.int().positive(), status: z.enum(['matched', 'diverged']) })).max(limits.events),
  actual: z.strictObject({
    orders: z.int().nonnegative().nullable(), checkout_complete: z.boolean(), matched_http: z.int().nonnegative(),
    unmatched_http: z.int().nonnegative(), checkout_requests: z.int().nonnegative(), page_errors: z.int().nonnegative()
  }),
  network: z.enum(['unverified', 'loopback-only']),
  duration_ms: z.int().nonnegative(),
  detail: z.string().max(200).optional(),
  capture: z.strictObject({
    events: z.array(eventSchema).min(2).max(limits.events), summary: captureSummarySchema
  }).optional()
});

export type RunResult = z.infer<typeof resultSchema>;

export function verdict(mode: 'record' | 'play' | 'verify', actual: RunResult['actual']): RunResult['status'] {
  if (actual.unmatched_http || actual.page_errors || actual.matched_http !== 1 || actual.checkout_requests !== 1) return 'DIVERGED';
  if (!actual.checkout_complete || actual.orders === null) return 'INCONCLUSIVE';
  if (actual.orders === 2) return { record: 'CAPTURED', play: 'REPRODUCED', verify: 'STILL_FAILING' }[mode] as RunResult['status'];
  if (actual.orders === 1) return mode === 'verify' ? 'FIX_VERIFIED' : 'NOT_REPRODUCED';
  return 'INCONCLUSIVE';
}

export const exitCodes: Record<RunResult['status'], number> = {
  CAPTURED: 0, REPRODUCED: 0, NOT_REPRODUCED: 3, FIX_VERIFIED: 0, STILL_FAILING: 4,
  DIVERGED: 5, INCONCLUSIVE: 6, BLOCKED: 7, ERROR: 8, CANCELLED: 130
};
