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
  ['tablet-landscape', 1024, 768, true],
  ['laptop', 1366, 768, false],
  ['wide-short', 1440, 320, false],
  ['desktop', 1440, 900, false],
  ['tall', 1440, 1700, false],
  ['fractional', 1023, 687, false],
  ['editorial-1920', 1920, 840, false],
  ['editorial-2560', 2560, 1080, false],
  ['editorial-3440', 3440, 1440, false],
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
    const rail = document.querySelector('line-minimap');
    const ink = document.querySelector('.repro-endmark span').getBoundingClientRect();
    const label = tab.querySelector('.repro-finish-label').getBoundingClientRect();
    const labelText = tab.querySelector('.repro-finish-text');
    const labelTextRect = labelText.getBoundingClientRect();
    const pocket = matchMedia('(max-width:600px)').matches;
    const viewportCenter = visualViewport.offsetTop + visualViewport.height / 2;
    const railBox = rail.getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('main h1, main h2, main p, main li, summary, .artifact code, .footer')]
      .filter(node => node.getClientRects().length && (!node.closest('details') || node.closest('details').open || node.closest('summary')))
      .some(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()].some(rect => Math.min(x + width, rect.right) - Math.max(x, rect.left) > .5 &&
          Math.min(y + height, rect.bottom) - Math.max(y, rect.top) > .5);
      });
    return {
      x, y, width, height, left, top, ruleRight, tracked, pocket, overlaps,
      railDisplay: getComputedStyle(rail).display, railCenter: (railBox.top + railBox.bottom) / 2, viewportCenter,
      progressLine: getComputedStyle(rule, '::after').transform,
      inkFits: ink.left >= footer.left && ink.right <= footer.right && ink.top >= footer.top && ink.bottom <= footer.bottom,
      labelFits: Number(getComputedStyle(labelText).opacity) === 0 ||
        (labelTextRect.left >= label.left - .1 && labelTextRect.right <= label.right + .1),
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
  if (state.pocket) {
    assert.equal(state.railDisplay, 'none');
    if (state.tracked) {
      near(state.y, 0, .05);
      near(state.y + state.height, 44, .05);
      near(state.x + state.width / 2, state.viewportWidth / 2, .05);
    } else near(state.y, state.top + 1);
  } else {
    assert.notEqual(state.railDisplay, 'none');
    near(state.railCenter, state.viewportCenter);
    near(state.y, state.top + 1);
    assert.equal(state.overlaps, false, 'tab does not cross visible article text');
  }
  assert.ok(state.labelFits, 'visible label fits during the sweep');
  assert.ok(state.height >= 43.99 && state.hit, '44 px target receives hits');
  assert.ok(state.x >= 0 && state.x + state.width <= state.viewportWidth + .1);
  assert.ok(state.y >= 0 && state.y + state.height <= state.viewportHeight + .1);
  near(state.scrollWidth, state.viewportWidth, 0);
  return state;
}

function docked(state) {
  assert.equal(state.tracked, false);
  assert.ok(state.inkFits, 'wordmark fits inside its footer band');
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
        if (!start.pocket) near(start.x + start.width, start.ruleRight);
        const outward = [start];
        for (let i = 1; i < 20; i++) outward.push(await step(page, i / 20));
        const end = await step(page, 1);
        docked(end);
        if (start.pocket) assert.notEqual(outward[10].progressLine, start.progressLine);
        else {
          for (let i = 1; i < outward.length; i++) {
            const before = outward[i - 1], after = outward[i];
            assert.ok(after.ruleRight - after.left >= before.ruleRight - before.left - .2, 'rule widens');
          }
        }
        const returning = await step(page, .5);
        near(returning.x, outward[10].x, .05);
        near(returning.top, outward[10].top, .05);
        const startAgain = await step(page, -1);
        near(startAgain.x, start.x, .05);
        near(startAgain.y, start.y, .05);
        if (name.startsWith('editorial')) {
          const editorial = await page.evaluate(() => {
            const proof = document.querySelectorAll('#file');
            const heading = document.querySelector('main h1').getBoundingClientRect();
            const paragraph = document.querySelector('.lede').getBoundingClientRect();
            return { count: proof.length, open: proof[0].open, proof: proof[0].getBoundingClientRect().left,
              heading: heading.right, measure: paragraph.width,
              wordmark: document.querySelector('.repro-endmark-band .wrap').getBoundingClientRect().width };
          });
          assert.equal(editorial.count, 1);
          assert.ok(editorial.open && editorial.proof > editorial.heading);
          assert.ok(editorial.measure <= 680 && editorial.wordmark >= 980);
        }
        if (screenshots) {
          for (const [position, fraction] of [['reading', -1], ['glide', .75], ['docked', 1]]) {
            await step(page, fraction);
            await page.locator('.repro-section-dot').evaluate(async dot => {
              await Promise.allSettled(dot.getAnimations({ subtree: true }).map(animation => animation.finished));
            });
            await page.screenshot({ path: join(screenshots, name + '-' + position + '.png'), scale: 'css' });
          }
        }
        if (name === 'phone-390') {
          await step(page, -1);
          const client = await page.context().newCDPSession(page);
          await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 480 }] });
          for (const y of [435, 385, 335, 290]) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y }] });
          }
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await page.waitForFunction(() => scrollY > 100);
          await client.detach();
          await page.setViewportSize({ width: height, height: width });
          assert.equal((await step(page, .5)).pocket, false);
          docked(await step(page, 1));
          await page.setViewportSize({ width, height });
          assert.equal((await step(page, -1)).pocket, true);
          docked(await step(page, 1));
          await page.locator('.footer a').focus();
          await page.keyboard.press('Tab');
          assert.equal(await tab.evaluate(link => link === document.activeElement), true);
          assert.equal(await step(page, -1).then(state => state.tracked), true);
          assert.equal(await tab.evaluate(link => link === document.activeElement), true);
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
        if (name === 'editorial-2560') {
          await step(page, -1);
          const summary = page.locator('#file > summary');
          const closedBeforeToggle = await summary.evaluate(disclosure => {
            disclosure.click();
            window.dispatchEvent(new Event('resize'));
            return !disclosure.parentElement.open;
          });
          assert.equal(closedBeforeToggle, true);
          await page.waitForFunction(() => !document.querySelector('#file').open);
          await page.setViewportSize({ width: 1366, height: 768 });
          await page.setViewportSize({ width, height });
          assert.equal(await page.locator('#file').evaluate(proof => proof.open), false);
          await summary.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('#file').evaluate(proof => proof.open), true);
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
