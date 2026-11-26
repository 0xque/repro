#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readCapsule, writeCapsule } from '../../capsule/src/index.js';
import { excluded } from '../../redaction/src/index.js';
import { ComparisonError, compareReports, formatComparison, readReport } from '../../replay/src/compare.js';
import { dockerReady, imageRevisions, runDocker } from '../../replay/src/docker.js';
import { initRecipe, loadRecipe, recipeDigest } from '../../replay/src/recipe.js';
import { exitCodes } from '../../replay/src/result.js';
import { chromiumRevision, files, httpFixture, json, oracle, origin, postgresFixture, recipeId } from '../../schema/src/index.js';
import type { Manifest } from '../../schema/src/index.js';
import { approveDraft, privateStore, purgeDrafts, readDraft, requestStop, requireApproval, saveDraft, startRecordingControl } from './store.js';

const string = { type: 'string' } as const;
const flag = { type: 'boolean' } as const;
const sessionArgs = { session: string };
const commands = {
  init: { project: string, image: string, variant: string, approve: flag },
  doctor: {},
  record: { project: string, url: string, profile: string, approve: flag, guided: flag },
  stop: { project: string, ...sessionArgs },
  review: { project: string, ...sessionArgs, approve: flag },
  export: { project: string, ...sessionArgs, out: string },
  inspect: { summary: flag },
  play: { project: string, offline: flag, approve: flag },
  compare: {},
  verify: { project: string, offline: flag, approve: flag },
  purge: { project: string, ...sessionArgs }
};
type Command = keyof typeof commands;
const help = `REPRO · fixture-backed checkout recordings

  repro init [--project DIR] [--image sha256:ID --variant bad|fixed --approve]
  repro doctor
  repro record --project DIR --url ${origin} --profile checkout-demo --approve [--guided]
  repro stop --project DIR [--session ID]
  repro review --project DIR --session ID [--approve]
  repro export --project DIR --session ID --out checkout.repro
  repro inspect checkout.repro [--summary]
  repro play checkout.repro --project DIR --offline --approve
  repro verify checkout.repro --project DIR --offline --approve
  repro compare checkout.repro baseline.json candidate.json [--json]
  repro purge --project DIR [--session ID]

Add --json to emit compact machine-readable output.
`;

class UsageError extends Error {}
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
let compact = false;

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, compact ? undefined : 2) + '\n');
}

async function main() {
  const [candidate, ...args] = process.argv.slice(2);
  if (!candidate || candidate === '--help' || candidate === '-h') {
    process.stdout.write(help);
    return 0;
  }
  if (!Object.hasOwn(commands, candidate)) throw new UsageError('Unknown command');
  const command = candidate as Command;
  const options = { json: flag, ...commands[command] };
  const parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  const values = parsed.values as Record<string, string | boolean | undefined>;
  compact = !!values.json;
  const needsCapsule = command === 'inspect' || command === 'play' || command === 'verify';
  if (parsed.positionals.length !== (command === 'compare' ? 3 : Number(needsCapsule))) throw new UsageError('Incorrect number of positional arguments');
  const project = resolve(String(values.project ?? '.'));
  const opts = (key: string) => {
    const value = values[key];
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new UsageError('--' + key + ' is required');
    return value;
  };

  switch (command) {
    case 'init': {
      if (!values.image && (values.variant || values.approve)) throw new UsageError('--variant and --approve require --image');
      const image = values.image ? opts('image') : undefined;
      if (image) {
        const variant = opts('variant');
        if ((variant !== 'bad' && variant !== 'fixed') || !values.approve) throw new UsageError('Specify --variant bad|fixed and --approve');
        await dockerReady();
        const revisions = await imageRevisions(image, variant);
        print({ recipe: await initRecipe(project, { image, variant, ...revisions }), state: 'approved' });
      } else print({ recipe: await initRecipe(project), state: 'template' });
      return 0;
    }
    case 'doctor': {
      const docker = await dockerReady().catch(() => null);
      const node_supported = process.version === 'v26.13.0';
      print({ node: process.version, node_supported, docker, execution_available: !!docker && node_supported });
      return docker && node_supported ? 0 : exitCodes.BLOCKED;
    }
    case 'inspect': {
      const { manifest, events, oracle, summary, oracleDigest } = await readCapsule(resolve(parsed.positionals[0]!));
      if (values.summary) {
        print({
          schema_version: manifest.schema_version,
          validated: true,
          event_count: events.length,
          entry_count: manifest.attachments.length,
          declared_entry_bytes: manifest.attachments.reduce((sum, entry) => sum + entry.bytes, 0),
          executed: false,
        });
      } else {
        print({ manifest, events, oracle, summary, oracle_sha256: oracleDigest, executed: false });
      }
      return 0;
    }
    case 'record': {
      if (opts('url') !== origin || opts('profile') !== 'checkout-demo' || !values.approve) {
        throw new UsageError('Use the approved checkout-demo profile, its loopback URL and --approve');
      }
      if (values.guided && !process.stdin.isTTY) throw new UsageError('--guided requires an interactive terminal');
      const recipe = await loadRecipe(project);
      if (recipe.variant !== 'bad') throw new UsageError('Recording requires the bad checkout variant');
      const store = await privateStore(project);
      await purgeDrafts(store);
      const id = randomUUID();
      const control = values.guided ? await startRecordingControl(store, id) : undefined;
      if (control) process.stderr.write('Guided recording session ' + id + '\n');
      const { capture, ...result } = await runDocker(recipe, {
        mode: command, postgres: postgresFixture, http: httpFixture, oracle, guided: !!values.guided
      }, abort.signal, control ? 300_000 : undefined, control && {
        requested: control.requested, cancel: () => abort.abort()
      }).finally(() => control?.close());
      if (result.status === 'CAPTURED' && !capture) throw new Error('Runner omitted capture');
      if (result.status !== 'CAPTURED' || !capture) {
        print(result);
        return exitCodes[result.status];
      }
      await saveDraft(store, { id, created_at: new Date().toISOString(), source_revision: recipe.source_revision,
        recipe_digest: recipeDigest(recipe), events: capture.events, summary: capture.summary });
      print({ ...result, session: id, revision: recipe.source_revision, recipe_digest: recipeDigest(recipe) });
      return 0;
    }
    case 'stop': {
      const store = await privateStore(project);
      print({ session: await requestStop(store, values.session ? opts('session') : undefined), stop_requested: true });
      return 0;
    }
    case 'review': {
      const id = opts('session');
      const store = await privateStore(project);
      const { draft, hash, files } = await readDraft(store, id);
      if (values.approve) await approveDraft(store, id, hash);
      print({
        session: id, approved: !!values.approve, draft_sha256: hash,
        retained: Object.fromEntries([...files].map(([name, contents]) => [name, contents.toString('utf8')])),
        provenance: { created_at: draft.created_at, source_revision: draft.source_revision, recipe_digest: draft.recipe_digest },
        excluded
      });
      return 0;
    }
    case 'export': {
      const id = opts('session');
      const out = resolve(opts('out'));
      if (!out.endsWith('.repro')) throw new UsageError('--out requires the .repro extension');
      const store = await privateStore(project);
      const { draft, hash, files: contents } = await readDraft(store, id);
      await requireApproval(store, id, hash);
      const manifest: Omit<Manifest, 'attachments'> = {
        schema_version: '1.0.0', capsule_id: id, title: 'Checkout duplicates order', created_at: draft.created_at,
        target: { source_revision: draft.source_revision, recipe_id: recipeId, recipe_digest: draft.recipe_digest,
          framework: 'node', browser: 'chromium', browser_revision: chromiumRevision, locale: 'en-US', timezone: 'UTC',
          viewport: [1280, 800] },
        required_capabilities: ['browser.chromium', 'postgres.fixture.v1', 'http.fixture.v1'],
        network_policy: 'external-deny', reproducibility: {
          grade: 'fixture-backed', known_gaps: ['Checkout fixture only; main frame and test IDs only']
        },
        privacy: { policy_version: '1', reviewed: true, contains_raw_capture: false },
        oracle: { path: files.oracle, version: 1 }
      };
      await writeCapsule(out, manifest, contents);
      print({ session: id, capsule: out });
      return 0;
    }
    case 'play':
    case 'verify': {
      if (!values.offline || !values.approve) throw new UsageError('Execution requires --offline and --approve');
      const capsule = await readCapsule(resolve(parsed.positionals[0]!));
      const recipe = await loadRecipe(project);
      const report = {
        mode: command, revision: recipe.source_revision, capture_revision: capsule.manifest.target.source_revision,
        recipe_digest: recipeDigest(recipe), oracle_sha256: capsule.oracleDigest, oracle: capsule.oracle,
        inventory: capsule.manifest.attachments, compatibility: capsule.manifest.reproducibility
      };
      if (report.recipe_digest !== capsule.manifest.target.recipe_digest ||
          (command === 'play' && recipe.source_revision !== report.capture_revision)) {
        print({ ...report, status: 'BLOCKED', phase: 'prepare', cleanup: 'not-needed', detail: 'Recipe or source revision mismatch' });
        return exitCodes.BLOCKED;
      }
      const { capture: _, ...result } = await runDocker(recipe, {
        mode: command, postgres: capsule.postgres, http: capsule.http, oracle: capsule.oracle,
        timeline: Buffer.concat(capsule.events.map(json)).toString('utf8'), guided: false
      }, abort.signal);
      print({ ...report, ...result });
      return exitCodes[result.status];
    }
    case 'compare': {
      const capsule = await readCapsule(resolve(parsed.positionals[0]!));
      const baseline = await readReport(resolve(parsed.positionals[1]!));
      const candidate = await readReport(resolve(parsed.positionals[2]!));
      const result = compareReports(capsule, baseline, candidate);
      if (values.json) print(result);
      else process.stdout.write(formatComparison(result));
      return exitCodes[result.status];
    }
    case 'purge': {
      const store = await privateStore(project);
      print({ purged: await purgeDrafts(store, values.session ? opts('session') : undefined) });
      return 0;
    }
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  const code = (error as NodeJS.ErrnoException)?.code;
  const detail = error instanceof UsageError || error instanceof ComparisonError ? error.message
    : code?.startsWith('ERR_PARSE_ARGS') ? 'Invalid command-line options'
    : code === 'ENOENT' ? 'Required file or approved review is missing'
    : code === 'EEXIST' ? 'Output already exists'
    : 'Invalid input, refused local resource or failed operation';
  process.stderr.write(JSON.stringify({ status: 'ERROR', detail }) + '\n');
  process.exitCode = exitCodes.ERROR;
}
