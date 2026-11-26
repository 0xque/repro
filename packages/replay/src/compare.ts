import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import type { Capsule } from '../../capsule/src/index.js';
import { digest, files, limits, manifestSchema, oracleSchema, parseJson } from '../../schema/src/index.js';
import { resultSchema, verdict } from './result.js';

const context = {
  mode: z.enum(['play', 'verify']),
  revision: digest,
  capture_revision: digest,
  recipe_digest: digest,
  oracle_sha256: digest,
  oracle: oracleSchema,
  inventory: manifestSchema.shape.attachments,
  compatibility: manifestSchema.shape.reproducibility,
};
const reportSchema = z.union([
  resultSchema.omit({ capture: true }).extend({
    ...context,
    cleanup: z.enum(['ok', 'incomplete', 'not-needed']),
  }),
  z.strictObject({
    ...context,
    status: z.literal('BLOCKED'),
    phase: z.literal('prepare'),
    cleanup: z.literal('not-needed'),
    detail: z.string().max(200),
  }),
]);

type Report = z.infer<typeof reportSchema>;

export class ComparisonError extends Error {}

export async function readReport(path: string): Promise<Report> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > limits.entry) {
      throw new ComparisonError('Run report must be a nonempty JSON file of at most 2 MiB');
    }
    // Bound the read even if a process grows the file after stat().
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new ComparisonError('Run report changed while being read');
    const result = reportSchema.safeParse(parseJson(buffer.subarray(0, length)));
    if (!result.success) throw new ComparisonError('Invalid saved play or verify report');
    return result.data;
  } finally {
    await handle.close();
  }
}

function validateIdentity(capsule: Capsule, report: Report, mode: Report['mode']) {
  if (report.mode !== mode) throw new ComparisonError('Supply a play report first and a verify report second');
  const manifest = capsule.manifest;
  const inventory = new Map(report.inventory.map((entry) => [entry.path, entry]));
  if (report.capture_revision !== manifest.target.source_revision ||
      report.recipe_digest !== manifest.target.recipe_digest ||
      report.oracle_sha256 !== capsule.oracleDigest ||
      inventory.get(files.oracle)?.sha256 !== capsule.oracleDigest ||
      report.inventory.length !== manifest.attachments.length ||
      inventory.size !== manifest.attachments.length ||
      manifest.attachments.some((entry) => {
        const declared = inventory.get(entry.path);
        return !declared || declared.sha256 !== entry.sha256 || declared.bytes !== entry.bytes;
      })) {
    throw new ComparisonError('Saved reports must match this capsule’s capture revision, recipe, oracle and inventory');
  }
}

export function compareReports(capsule: Capsule, baseline: Report, candidate: Report) {
  validateIdentity(capsule, baseline, 'play');
  validateIdentity(capsule, candidate, 'verify');
  const expectedCount = capsule.events.length - 1;

  function summarize(report: Report) {
    const events = 'events' in report ? report.events : [];
    let matched = 0;
    let divergent = false;
    for (const [index, event] of events.entries()) {
      if (event.seq !== index + 1 || event.seq > expectedCount || divergent) {
        throw new ComparisonError('Saved run timeline is not a valid prefix of this capsule');
      }
      if (event.status === 'matched') matched++;
      else divergent = true;
    }
    const first = capsule.events[matched];
    const firstUnmatched = matched < expectedCount && first ? {
      sequence: first.seq, action: first.kind,
      ...('test_id' in first ? { test_id: first.test_id } : {}),
      state: divergent ? 'diverged' as const : 'not-recorded' as const,
    } : null;
    const actual = 'actual' in report &&
      (report.phase === 'report' || report.phase === 'assert') ? report.actual : null;
    return {
      status: report.status,
      revision: report.revision,
      count: actual?.orders ?? null,
      timeline: { matched, expected: expectedCount, first_unmatched: firstUnmatched },
      complete: report.phase === 'report' && matched === expectedCount && !!actual &&
        'network' in report && report.network === 'loopback-only' && report.cleanup === 'ok' &&
        verdict(report.mode, actual) === report.status,
    };
  }

  const before = summarize(baseline);
  const after = summarize(candidate);
  const expected = capsule.oracle.failure.expected;
  const reproduced = before.complete && before.status === 'REPRODUCED' &&
    before.revision === capsule.manifest.target.source_revision &&
    before.count === capsule.oracle.failure.observe;
  const different = before.revision !== after.revision;
  let status: 'FIX_VERIFIED' | 'STILL_FAILING' | 'DIVERGED' | 'INCONCLUSIVE' = 'INCONCLUSIVE';
  let reason = 'A complete reproduced baseline and a complete verification report are required';
  if (before.timeline.first_unmatched?.state === 'diverged' ||
      after.timeline.first_unmatched?.state === 'diverged' ||
      (before.complete && before.status === 'DIVERGED') || (after.complete && after.status === 'DIVERGED')) {
    status = 'DIVERGED';
    reason = 'The saved run reports a different action or fixture outcome';
  } else if (reproduced && after.complete && after.status === 'STILL_FAILING') {
    status = 'STILL_FAILING';
    reason = 'The candidate still produces the duplicate order count';
  } else if (reproduced && after.complete && after.status === 'FIX_VERIFIED' && after.count === expected) {
    if (different) {
      status = 'FIX_VERIFIED';
      reason = 'The same capsule reproduced the duplicate on the baseline and met the oracle on a different revision';
    } else {
      reason = 'Both reports claim the same revision; the candidate is not a demonstrated fix';
    }
  }
  return {
    comparison_version: 1 as const,
    status,
    reason,
    executed: false as const,
    evidence: 'saved-reports-not-authenticated' as const,
    baseline: before,
    candidate: after,
    oracle: {
      name: capsule.oracle.failure.oracle, expected,
      baseline: before.count, candidate: after.count,
      delta: before.count === null || after.count === null ? null : after.count - before.count,
    },
  };
}

export function formatComparison(result: ReturnType<typeof compareReports>): string {
  const lines = [result.status + ' · ' + result.reason, ''];
  for (const [label, run] of [['Baseline', result.baseline], ['Candidate', result.candidate]] as const) {
    lines.push(`${label}: ${run.status} · ${run.revision.slice(0, 12)} · ${run.timeline.matched}/${run.timeline.expected} actions matched`);
    const step = run.timeline.first_unmatched;
    if (step) lines.push(`  First unmatched: #${step.sequence} ${step.action}${step.test_id ? ' ' + step.test_id : ''} (${step.state})`);
  }
  const { oracle } = result;
  lines.push('', `Oracle: ${oracle.name}, expected ${oracle.expected}`,
    `Observed: ${oracle.baseline ?? 'unavailable'} → ${oracle.candidate ?? 'unavailable'}${oracle.delta === null ? '' : ' (Δ ' + oracle.delta + ')'}`,
    '', 'Compared saved reports only. No replay ran and the reports are not authenticated.');
  return lines.join('\n') + '\n';
}
