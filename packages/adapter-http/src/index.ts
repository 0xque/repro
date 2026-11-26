import type { BrowserContext } from 'playwright';
import { origin } from '../../schema/src/index.js';
import type { httpFixture } from '../../schema/src/index.js';

const appRequests = new Set(['GET /', 'GET /checkout.js', 'POST /checkout']);

export async function installHttpPolicy(context: BrowserContext, fixture: typeof httpFixture) {
  const counts = { matched: 0, unmatched: 0, checkout: 0 };
  await context.routeWebSocket('**/*', (socket) => {
    counts.unmatched++;
    socket.close({ code: 1008, reason: 'Blocked by replay policy' });
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const identity = request.method() + ' ' + url.pathname;
    if (url.origin === origin && !url.search && !url.username && !url.password && appRequests.has(identity)) {
      if (identity === 'POST /checkout') {
        if (counts.checkout !== 0) {
          counts.unmatched++;
          return route.abort('blockedbyclient');
        }
        counts.checkout++;
      }
      return route.continue();
    }
    if (request.url() === fixture.request.url && request.method() === fixture.request.method &&
        request.postData() === null && counts.matched === 0) {
      counts.matched++;
      return route.fulfill({
        status: fixture.response.status, json: { cents: fixture.response.cents },
        headers: { 'access-control-allow-origin': origin }
      });
    }
    counts.unmatched++;
    return route.abort('blockedbyclient');
  });
  return counts;
}
