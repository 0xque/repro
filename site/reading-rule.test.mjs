import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import worker from './worker.mjs';

const target = 'https://github.com/0xQuerencia/repro';
const screenshots = process.env.REPRO_SCREENSHOTS;
const matrix = [
  ['phone-320', 320, 568, true],
  ['phone-390', 390, 844, true],
  ['landscape', 844, 390, true],
  ['tablet-768', 768, 1024, true],
  ['tablet-820', 820, 1180, true],
  ['wide-short', 1440, 320, false],
  ['desktop', 1440, 900, false],
  ['tall', 1440, 1700, false],
  ['fractional', 1023, 687, false],
];

const near = (a, b, tolerance = 1) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

async function read(page) {
  return page.evaluate(() => {
    const rule = document.querySelector('.repro-reading-rule');
    const tab = rule.querySelector('a');
    const { x, y, width, height } = tab.getBoundingClientRect();
    const { left, top, right } = rule.getBoundingClientRect();
    const footer = rule.parentElement.getBoundingClientRect();
    const tracked = rule.hasAttribute('data-tracking');
    const ruleRight = tracked ? left + Number(rule.style.getPropertyValue('--rule-width')) : right;
    const viewport = document.documentElement;
    return {
      x, y, width, height, left, top, ruleRight, tracked,
      footerTop: footer.top, footerLeft: footer.left, footerRight: footer.right,
      viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight,
      scrollWidth: viewport.scrollWidth,
      badge: getComputedStyle(document.querySelector('.line-minimap__guide span')).display,
      linkCount: document.querySelectorAll('.repro-finish-link').length,
      hit: [3, height - 3].every(dy => document.elementFromPoint(x + width / 2, y + dy)?.closest('a') === tab),
    };
  });
}

async function step(page, fraction) {
  await page.evaluate(async fraction => {
    const root = document.scrollingElement;
    const height = root.clientHeight;
    const distance = root.scrollHeight - height;
    const handoff = Math.min(Math.max(72, Math.min(200, height * .28)), distance * .65);
    const top = fraction < 0 ? 0 : distance - handoff * (1 - fraction);
    scrollTo({ top, behavior: 'instant' });
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  }, fraction);
  const state = await read(page);
  assert.equal(state.linkCount, 1);
  assert.equal(state.badge, 'none');
  near(state.y, state.top + 1);
  assert.ok(state.height >= 43.99 && state.hit, '44 px target receives hits');
  assert.ok(state.x >= 0 && state.x + state.width <= state.viewportWidth + .1);
  assert.ok(state.y >= 0 && state.y + state.height <= state.viewportHeight + .1);
  near(state.scrollWidth, state.viewportWidth, 0);
  return state;
}

function docked(state) {
  assert.equal(state.tracked, false);
  near(state.top, state.footerTop, .05);
  near(state.left, state.footerLeft, .05);
  near(state.ruleRight, state.footerRight, .05);
  near(state.x + state.width / 2, (state.footerLeft + state.footerRight) / 2, .05);
}

test('Worker entry point keeps one operable tab attached through the reading-rule handoff', async (t) => {
  const server = createServer(async (request, response) => {
    const result = await worker.fetch(new Request('http://localhost' + request.url));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.REPRO_CHROMIUM });
  t.after(() => browser.close());
  if (screenshots) await mkdir(screenshots, { recursive: true });

  for (const [name, width, height, mobile] of matrix) {
    await t.test(name, async () => {
      const page = await browser.newPage({
        viewport: { width, height }, deviceScaleFactor: name === 'fractional' ? 1.25 : mobile ? 2 : 1,
        isMobile: mobile, hasTouch: mobile,
      });
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        const response = await page.goto(url);
        assert.equal(response.status(), 200);
        assert.ok(response.headers()['content-security-policy']);
        await page.locator('.line-minimap__range').waitFor({ state: 'attached' });
        await page.evaluate(() => document.fonts.ready);
        const tab = page.getByRole('link', { name: /REPRO on GitHub.*private/i });
        assert.equal(await tab.getAttribute('href'), target);
        const start = await step(page, -1);
        assert.equal(start.tracked, true);
        near(start.x + start.width, start.ruleRight);
        const outward = [start];
        for (const fraction of [.25, .5, .75, .93, 1]) outward.push(await step(page, fraction));
        docked(outward.at(-1));
        for (let i = 1; i < outward.length; i++) {
          const before = outward[i - 1], after = outward[i];
          assert.ok(after.top + .5 >= before.top, 'rule descends');
          assert.ok(after.ruleRight - after.left >= before.ruleRight - before.left - .2, 'rule widens');
          assert.ok(after.x <= before.x + .2, 'tab approaches center');
        }
        const returning = await step(page, .5);
        near(returning.x, outward[2].x, .05);
        near(returning.top, outward[2].top, .05);
        if (screenshots && ['phone-390', 'desktop'].includes(name)) {
          for (const [position, fraction] of [['reading', -1], ['glide', .5], ['docked', 1]]) {
            await step(page, fraction);
            await page.screenshot({ path: join(screenshots, name + '-' + position + '.png'), scale: 'css' });
          }
        }
        if (name === 'phone-390') {
          await page.setViewportSize({ width: height, height: width });
          await step(page, .5);
          docked(await step(page, 1));
          await page.setViewportSize({ width, height });
          docked(await step(page, 1));
          let tapped = false;
          await page.route(target, route => { tapped = true; return route.fulfill({ body: 'GitHub destination' }); });
          await tab.tap();
          await page.waitForURL(target);
          assert.equal(tapped, true);
        }
        if (name === 'desktop') {
          await step(page, -1);
          await page.waitForFunction(() => document.documentElement.classList.contains('lenis'));
          await page.mouse.wheel(0, 300);
          await page.waitForFunction(() => scrollY >= 295);
          await page.mouse.wheel(0, -260);
          await page.waitForFunction(() => scrollY < 75);
          await page.locator('.line-minimap__range').focus();
          await page.keyboard.press('End');
          await page.waitForFunction(() => !document.querySelector('.repro-reading-rule').hasAttribute('data-tracking'));
          docked(await read(page));
          await page.locator('.footer a').focus();
          await page.keyboard.press('Tab');
          assert.equal(await tab.evaluate(link => link.matches(':focus-visible')), true);
          assert.equal(await tab.locator('.repro-finish-label').evaluate(label => getComputedStyle(label).outlineStyle), 'solid');
          await step(page, .5);
          assert.equal(await tab.evaluate(link => link === document.activeElement), true);
          await step(page, 1);
          const wordmark = page.locator('.repro-endmark span');
          await wordmark.hover();
          await wordmark.waitFor({ state: 'visible' });
          await page.waitForFunction(() => document.querySelector('.repro-endmark span').hasAttribute('data-foil'));
          await page.route(target, route => route.fulfill({ body: 'GitHub destination' }));
          await page.keyboard.press('Enter');
          await page.waitForURL(target);
        }
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }

  await t.test('reduced motion and no-script footer', async () => {
    const reduced = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    await reduced.goto(url);
    await reduced.locator('.line-minimap__range').waitFor({ state: 'attached' });
    const start = await step(reduced, -1);
    const approaching = await step(reduced, .75);
    near(start.x, approaching.x, .05);
    assert.equal(await reduced.locator('html').evaluate(root => root.classList.contains('lenis')), false);
    docked(await step(reduced, 1));
    await reduced.close();

    const fallback = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
    await fallback.goto(url);
    assert.equal(await fallback.getByRole('navigation', { name: 'On this page' }).getByRole('link').count(), 4);
    const link = fallback.getByRole('link', { name: /REPRO on GitHub.*private/i });
    await link.scrollIntoViewIfNeeded();
    await fallback.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    assert.equal(await link.getAttribute('href'), target);
    const rule = await fallback.locator('.repro-reading-rule').boundingBox();
    const tab = await link.boundingBox();
    near(tab.y, rule.y + 1, .05);
    near(tab.x + tab.width / 2, rule.x + rule.width / 2, .05);
    await fallback.close();
  });
});
