import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { playwrightVersion, digest, limits, parseJson } from '../../schema/src/index.js';
import { resultSchema } from './result.js';
import type { RunResult } from './result.js';
import type { Recipe } from './recipe.js';

const exec = promisify(execFile);
const socket = '/var/run/docker.sock';
const host = ['--host', 'unix://' + socket];
const environment = { PATH: process.env.PATH };
const worker = '/app/dist/packages/replay/src/worker.js';
const containerUser = '1001:1001';

async function docker(args: string[]) {
  const { stdout } = await exec('docker', [...host, ...args], { env: environment, timeout: 8_000, maxBuffer: 128 * 1024 });
  return stdout.trim();
}

export async function dockerReady() {
  if (!(await stat(socket)).isSocket()) throw new Error('Local Docker socket unavailable');
  const platform = await docker(['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']);
  if (platform !== 'linux/amd64') throw new Error('Unsupported Docker platform');
  return platform;
}

async function inspectImage(image: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Expected a local Docker image ID');
  return JSON.parse(await docker(['image', 'inspect', image, '--format', '{{json .}}']));
}

export async function imageRevisions(image: string, variant: 'bad' | 'fixed') {
  const info = await inspectImage(image);
  const revision: unknown = info.Config.Labels?.['repro.source.' + variant];
  const contract: unknown = info.Config.Labels?.['repro.contract'];
  if (info.Id !== image || info.Config.Labels?.['repro.recipe'] !== 'checkout-v1' || !digest.safeParse(revision).success) {
    throw new Error('Image does not declare a checkout fixture source');
  }
  return { source_revision: digest.parse(revision), recipe_revision: digest.parse(contract) };
}

async function validateImage(recipe: Recipe) {
  const info = await inspectImage(recipe.image);
  if (info.Id !== recipe.image || info.Config.Labels?.['repro.recipe'] !== recipe.recipe ||
      info.Config.Labels?.['repro.playwright'] !== playwrightVersion ||
      info.Config.Labels?.['repro.contract'] !== recipe.recipe_revision ||
      info.Config.Labels?.['repro.source.' + recipe.variant] !== recipe.source_revision ||
      Object.keys(info.Config.Volumes ?? {}).length) {
    throw new Error('Recipe image or revision mismatch');
  }
}

async function validateContainer(name: string, recipe: Recipe) {
  const info = JSON.parse(await docker(['inspect', '--type', 'container', name, '--format', '{{json .}}']));
  const config = info.HostConfig;
  if (info.Image !== recipe.image || info.Config.User !== containerUser ||
      config.NetworkMode !== 'none' || config.Privileged || config.CgroupnsMode !== 'private' || config.IpcMode !== 'private' ||
      config.Devices?.length || config.DeviceRequests?.length || config.Init !== true || !config.AutoRemove || config.ReadonlyRootfs !== true ||
      config.PublishAllPorts || Object.keys(config.PortBindings ?? {}).length ||
      config.Binds?.length || config.Mounts?.length || info.Mounts?.length ||
      config.CapAdd?.length || !config.CapDrop?.includes('ALL') ||
      !config.SecurityOpt?.some((value: string) => ['no-new-privileges', 'no-new-privileges:true'].includes(value)) ||
      config.Memory !== 1024 ** 3 || config.MemorySwap !== 1024 ** 3 || config.NanoCpus !== 2_000_000_000 || config.PidsLimit !== 256 ||
      Object.keys(config.Tmpfs ?? {}).join() !== '/tmp') {
    throw new Error('Docker isolation settings were not enforced');
  }
}

function failure(status: RunResult['status'], detail: string): RunResult {
  return {
    status, detail, phase: 'prepare', network: 'unverified', duration_ms: 0, events: [],
    actual: { orders: null, checkout_complete: false, matched_http: 0, unmatched_http: 0, checkout_requests: 0, page_errors: 0 }
  };
}

export type StopControl = { requested: () => Promise<boolean>; cancel: () => void };

type Input = { mode: 'record' | 'play' | 'verify'; postgres: unknown; http: unknown; oracle: unknown; timeline?: string; guided: boolean };

async function start(name: string, input: Input, recipe: Recipe, signal: AbortSignal, stop?: StopControl) {
  signal.throwIfAborted();
  const child = spawn('docker', [...host, 'start', '--attach', '--interactive', name], {
    env: environment, signal, stdio: ['pipe', 'pipe', 'pipe']
  });
  const finished = once(child, 'close');
  child.stdin.on('error', () => {});
  const payload = JSON.stringify({ ...input, variant: recipe.variant }) + '\n';
  if (input.guided) {
    child.stdin.write(payload);
    process.stdin.pipe(child.stdin);
  } else child.stdin.end(payload);
  const chunks: Buffer[] = [];
  let bytes = 0;
  let oversized = false;
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limits.entry) {
      oversized = true;
      child.kill();
    } else chunks.push(chunk);
  });
  let stderr = '';
  let awaitingMarker = false;
  child.stderr.on('data', (chunk: Buffer) => {
    if (!input.guided || stderr.length + chunk.length > 8192) return;
    stderr += chunk.toString('utf8');
    const lines = stderr.split('\n');
    stderr = lines.pop() ?? '';
    for (const line of lines) {
      if (/^Recording (navigate|click|fill|wait|failure) \([a-z-]+\)\. Press Enter to continue\.$/.test(line)) {
        awaitingMarker = line.startsWith('Recording failure (');
        process.stderr.write(line + '\n');
      }
    }
  });
  let pendingRequest = false;
  let handled = false;
  const checkStop = stop && setInterval(async () => {
    if (pendingRequest || handled) return;
    pendingRequest = true;
    try {
      if (await stop.requested()) {
        handled = true;
        if (awaitingMarker) child.stdin.write('\n');
        else stop.cancel();
      }
    } catch {
      stop.cancel();
    } finally {
      pendingRequest = false;
    }
  }, 100).unref();
  try {
    const [code] = await finished;
    if (code !== 0 || oversized) throw new Error('Container did not return a bounded result');
    return resultSchema.parse(parseJson(Buffer.concat(chunks)));
  } finally {
    if (checkStop) clearInterval(checkStop);
    if (input.guided) {
      process.stdin.unpipe(child.stdin);
      process.stdin.pause();
    }
  }
}

export async function runDocker(recipe: Recipe, input: Input, signal: AbortSignal, timeoutMs = 60_000, stop?: StopControl) {
  const name = 'repro-' + randomUUID();
  const deadline = AbortSignal.timeout(timeoutMs);
  const cancelled = AbortSignal.any([signal, deadline]);
  let result: RunResult;
  let cleanup: 'ok' | 'incomplete' | 'not-needed' = 'not-needed';
  let attempted = false;
  let started = false;
  const verbose = process.env.REPRO_VERBOSE === '1';
  if (verbose) process.stderr.write('[repro] Checking the local Docker recipe and isolation settings.\n');
  try {
    await dockerReady();
    await validateImage(recipe);
    cancelled.throwIfAborted();
    attempted = true;
    await docker([
      'create', '--name', name, '--pull=never', '--rm', '--network=none', '--interactive', '--init',
      '--cgroupns=private', '--ipc=private', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--read-only', '--pids-limit=256', '--memory=1g', '--memory-swap=1g', '--cpus=2',
      '--tmpfs=/tmp:rw,nosuid,nodev,size=384m,mode=1777', '--shm-size=96m', '--user', containerUser,
      '--log-driver=none', '--entrypoint', '/usr/bin/timeout', '--env', 'HOME=/tmp',
      '--env', 'DEBUG=', '--label', 'repro.ephemeral=true',
      '--label', 'repro.owner-pid=' + process.pid, recipe.image,
      '--signal=KILL', input.guided ? '310s' : '70s', '/usr/local/bin/node', worker
    ]);
    await validateContainer(name, recipe);
    started = true;
    if (verbose) process.stderr.write('[repro] Running ' + input.mode + ' in ' + name + '.\n');
    result = await start(name, input, recipe, cancelled, stop);
    if (result.network !== 'loopback-only' && result.status !== 'BLOCKED') {
      result = failure('BLOCKED', 'Runner could not confirm loopback-only isolation');
    }
  } catch {
    result = signal.aborted ? failure('CANCELLED', 'Run cancelled by operator')
      : deadline.aborted ? failure('INCONCLUSIVE', 'Runner deadline exceeded')
      : started ? failure('ERROR', 'Isolated runner did not return a result')
      : failure('BLOCKED', 'Local Docker, approved image or isolation preflight failed');
  } finally {
    if (attempted) {
      try {
        await docker(['rm', '--force', '--volumes', name]);
        cleanup = 'ok';
      } catch {
        const remaining = await docker(['ps', '-aq', '--filter', 'name=^/' + name + '$']).catch(() => undefined);
        cleanup = remaining === '' ? 'ok' : 'incomplete';
      }
    }
  }
  if (cleanup === 'incomplete') {
    result.status = 'ERROR';
    result.phase = 'cleanup';
    result.detail = 'Could not confirm removal of owned container ' + name;
    delete result.capture;
  }
  if (verbose) process.stderr.write('[repro] ' + result.status + ' at ' + result.phase + '. Cleanup ' + cleanup + '.\n');
  return { ...result, cleanup };
}
