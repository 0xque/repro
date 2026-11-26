import { performance } from 'node:perf_hooks';
import type { BrowserContext, Page } from 'playwright';
import { eventSchema, origin } from '../../schema/src/index.js';
import type { Event } from '../../schema/src/index.js';

type Action = Exclude<Event, { kind: 'failure' }>;
type ActionInput = Action extends infer Item ? Item extends Action ? Omit<Item, 'seq' | 't_us' | 'page' | 'timeout_ms'> : never : never;

export class ActionDivergence extends Error {}

export async function executeAction(page: Page, event: Action) {
  const timeout = event.timeout_ms;
  if (event.kind === 'navigate') {
    const response = await page.goto(origin + event.path, { timeout, waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new ActionDivergence('Application navigation failed');
    return;
  }
  if (page.url() !== origin + '/' || page.frames().length !== 1) throw new ActionDivergence('Unsupported frame or navigation');

  const target = page.getByTestId(event.test_id);
  try {
    await target.waitFor({ state: 'visible', timeout });
    if (event.kind === 'click') await target.click({ timeout });
    if (event.kind === 'fill') await target.fill(event.value, { timeout });
  } catch {
    if (await target.count().catch(() => 0) > 1) throw new ActionDivergence('Selector matched more than one target');
    throw new ActionDivergence('Selector missing or action deadline exceeded');
  }
}

export const demoActions: ActionInput[] = [
  { kind: 'navigate', path: '/' },
  { kind: 'click', test_id: 'add-product' },
  { kind: 'fill', test_id: 'order-label', value: 'Sample label' },
  { kind: 'click', test_id: 'place-order' },
  { kind: 'wait', test_id: 'confirmation' }
];

type GuidedInput = (action: ActionInput | { kind: 'failure' }) => Promise<void>;

export async function captureBrowser(context: BrowserContext, page: Page, guide?: GuidedInput) {
  const started = performance.now();
  const events: Event[] = [];
  let expected: ActionInput | undefined;
  let observed = 0;
  let unsupported = false;
  const boundary = () => ({
    seq: events.length + 1, t_us: Math.round((performance.now() - started) * 1000),
    page: 'main', timeout_ms: 5_000
  });
  await context.exposeBinding('reproObserve', (source, kind: unknown, target: unknown, synthetic: unknown) => {
    if (source.page !== page || source.frame !== page.mainFrame() || source.frame.url() !== origin + '/' ||
        (expected?.kind !== 'click' && expected?.kind !== 'fill') || expected.kind !== kind ||
        expected.test_id !== target || (kind === 'fill' && synthetic !== true)) {
      unsupported = true;
      return;
    }
    observed++;
  });
  await context.addInitScript((allowedOrigin) => {
    if (location.origin !== allowedOrigin || window.top !== window) return;
    const observe = (window as unknown as {
      reproObserve: (kind: string, testId: string | null, synthetic: boolean) => Promise<void>
    }).reproObserve;
    const bindings = new Set<Promise<void>>();
    const fixtureWindow = window as Window & { reproFlush?: () => Promise<void[]> };
    fixtureWindow.reproFlush = () => Promise.all(bindings);
    for (const type of ['click', 'input']) {
      document.addEventListener(type, (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const testId = event.target.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
        const synthetic = event.target instanceof HTMLInputElement && event.target.value === 'Sample label';
        const binding = observe(type === 'input' ? 'fill' : 'click', testId, synthetic);
        bindings.add(binding);
        void binding.then(() => bindings.delete(binding));
      }, { capture: true });
    }
  }, origin);

  for (const action of demoActions) {
    await guide?.(action);
    expected = action;
    observed = 0;
    const event = eventSchema.parse({ ...boundary(), ...action }) as Action;
    await executeAction(page, event);
    await page.evaluate(() => (window as Window & { reproFlush?: () => Promise<void[]> }).reproFlush?.());
    if (unsupported || (['click', 'fill'].includes(action.kind) && observed !== 1)) throw new Error('Browser capture observed unexpected activity');
    events.push(event);
  }
  return {
    events,
    async markFailure() {
      await guide?.({ kind: 'failure' });
      if (unsupported) throw new Error('Browser capture observed unexpected activity');
      events.push(eventSchema.parse({ ...boundary(), kind: 'failure', oracle: 'order-count' }));
    }
  };
}
