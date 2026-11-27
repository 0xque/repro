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
      strokeMask: getComputedStyle(rule, '::before').maskImage,
      markerDisplay: getComputedStyle(document.querySelector('.repro-section-dot')).display,
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
  assert.equal(state.strokeMask, 'none', 'the reading stroke has no gap over the article');
  if (state.pocket) {
    assert.equal(state.railDisplay, 'none');
    assert.equal(state.markerDisplay, 'none');
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

  await t.test('specimen contact shares the border and the dot rebounds once', async t => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1.25 });
    try {
      await page.goto(url);
      await page.waitForSelector('html[data-reading-rule-ready]', { state: 'attached' });
      await page.evaluate(() => document.fonts.ready);
      const frames = await page.evaluate(async () => {
        const proof = document.getElementById('file');
        const rule = document.querySelector('.repro-reading-rule');
        const dot = document.querySelector('.repro-section-dot i');
        const rail = document.querySelector('line-minimap');
        const root = document.scrollingElement;
        const border = parseFloat(getComputedStyle(proof).borderBottomWidth);
        const track = rail.getBoundingClientRect();
        const distance = root.scrollHeight - root.clientHeight;
        const edge = proof.getBoundingClientRect().bottom - border;
        const contact = Math.max((edge - track.top) / (1 + (track.height - 1) / distance), edge - (root.clientHeight - 45));
        const samples = [];
        for (let scroll = Math.max(0, Math.floor(contact) - 91); scroll <= contact + 144; scroll += 2) {
          scrollTo({ top: scroll, behavior: 'instant' });
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          if (!dot.parentElement.hasAttribute('data-specimen-spring')) continue;
          const line = rule.getBoundingClientRect(), marker = dot.getBoundingClientRect();
          const row = proof.getBoundingClientRect(), ruler = rail.getBoundingClientRect();
          samples.push({ scroll, y: line.top, bottom: marker.bottom, clearance: line.top - marker.bottom, border,
            railCenter: (ruler.top + ruler.bottom) / 2,
            scale: marker.height / dot.offsetHeight, docked: rule.hasAttribute('data-specimen-docked'),
            borderDelta: line.top - (row.bottom - border), thickness: line.height,
            markerX: marker.left + marker.width / 2,
            expectedX: row.left - 15,
            filenameY: proof.querySelector('.filename').getBoundingClientRect().top +
              proof.querySelector('.filename').getBoundingClientRect().height / 2,
            markerY: (marker.top + marker.bottom) / 2,
            fullStroke: getComputedStyle(rule, '::before').maskImage === 'none',
          });
        }
        return samples;
      });
      assert.ok(frames.length >= 60);
      assert.ok(frames.every(frame => frame.bottom <= frame.y + .05), 'the dot never crosses the line');
      assert.ok(frames.every(frame => Math.abs(frame.railCenter - 384) < .1));
      const firstContact = frames.findIndex(frame => frame.docked);
      assert.ok(firstContact >= 10);
      for (let i = 1; i < firstContact; i++) {
        assert.ok(frames[i].y >= frames[i - 1].y - .05, 'the approach line only moves downward');
      }
      const dockedFrames = frames.filter(frame => frame.docked);
      assert.ok(dockedFrames.length > 20);
      for (const frame of dockedFrames) {
        near(frame.borderDelta, 0, .05);
        near(frame.thickness, frame.border, .05);
        assert.equal(frame.fullStroke, true);
      }
      const compression = dockedFrames.reduce((best, frame) => frame.scale < best.scale ? frame : best);
      near(compression.clearance, 0, .05);
      assert.ok(compression.scale < .73);
      const apex = dockedFrames.reduce((best, frame) => frame.clearance > best.clearance ? frame : best);
      const settled = dockedFrames.at(-1);
      t.diagnostic(`${frames.length} sampled frames, ${dockedFrames.length} aligned border frames, compression at ${(compression.scale * 100).toFixed(1)}% height`);
      assert.ok(apex.scroll > compression.scroll && apex.clearance > settled.clearance + 7);
      near(settled.markerX, settled.expectedX, .05);
      near(settled.markerY, settled.filenameY, .05);
      const rebound = dockedFrames.filter(frame => frame.scroll > compression.scroll);
      for (let i = 1; i < rebound.length; i++) {
        const previous = rebound[i - 1], current = rebound[i];
        assert.ok(current.scroll <= apex.scroll
          ? current.clearance >= previous.clearance - .1
          : current.clearance <= previous.clearance + .1, 'the rebound has exactly one apex');
      }

      for (const [name, sample] of [['drop', frames[Math.floor(firstContact / 2)]],
        ['contact', compression], ['rebound', apex], ['settled', settled], ['reverse-contact', compression]]) {
        await page.evaluate(scroll => scrollTo({ top: scroll, behavior: 'instant' }), sample.scroll);
        await page.waitForFunction(({ y, bottom }) => {
          const line = document.querySelector('.repro-reading-rule').getBoundingClientRect();
          const dot = document.querySelector('.repro-section-dot i').getBoundingClientRect();
          return Math.abs(line.top - y) < .05 && Math.abs(dot.bottom - bottom) < .05;
        }, sample);
        if (screenshots) await page.screenshot({ path: join(screenshots, 'specimen-' + name + '.png'), scale: 'css' });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => !document.querySelector('[data-specimen-spring], [data-specimen-docked]'));
      assert.equal(await page.locator('line-minimap').evaluate(rail => getComputedStyle(rail).display), 'none');
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(scroll => scrollTo({ top: scroll, behavior: 'instant' }), compression.scroll);
      await page.waitForFunction(() => !document.querySelector('[data-specimen-spring], [data-specimen-docked]'));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForSelector('[data-specimen-docked]', { state: 'attached' });
      await page.locator('#file > summary').evaluate(summary => summary.click());
      await page.waitForFunction(() => !document.querySelector('[data-specimen-spring], [data-specimen-docked]'));
    } finally {
      await page.close();
    }
  });

  await t.test('the marker morphs and rebounds at each later target and retraces on a fast scrub', async () => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    try {
      await page.goto(url);
      await page.waitForSelector('html[data-reading-rule-ready]', { state: 'attached' });
      await page.evaluate(() => document.fonts.ready);
      const frames = await page.evaluate(async () => {
        const dot = document.querySelector('.repro-section-dot i');
        const headings = [...document.querySelectorAll('.workflow h2, .field-note h2')];
        const distance = document.scrollingElement.scrollHeight - innerHeight;
        const samples = [];
        for (let top = 200; top < distance; top += 4) {
          scrollTo({ top, behavior: 'instant' });
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          if (dot.parentElement.hasAttribute('data-specimen-spring')) continue;
          const { x, y, width, height } = dot.getBoundingClientRect();
          const markers = headings.map(heading => {
            const box = heading.getBoundingClientRect();
            return {
              x: box.left - 15,
              y: box.top + Math.min(box.height, parseFloat(getComputedStyle(heading).lineHeight)) / 2,
            };
          });
          samples.push({ top, x: x + width / 2, y: y + height / 2, width, height, diameter: dot.offsetHeight, markers });
        }
        return samples;
      });
      const squashes = [];
      for (let i = 0; i < 3; i++) {
        const onTarget = frame => Math.abs(frame.x - frame.markers[i].x) < .1;
        const squash = frames.find(frame => onTarget(frame) && frame.height < frame.diameter * .4 &&
          Math.abs(frame.y - frame.markers[i].y) < frame.diameter / 2 && frame.width > frame.diameter * 1.5);
        assert.ok(squash, 'the dot flattens at heading ' + (i + 1));
        const rebound = frames.find(frame => frame.top > squash.top && frame.top < squash.top + 30 &&
          onTarget(frame) && frame.y < frame.markers[i].y - 5 && frame.height > squash.height);
        const settled = frames.find(frame => frame.top > (rebound?.top ?? Infinity) && onTarget(frame) &&
          Math.abs(frame.y - frame.markers[i].y) < .1 && Math.abs(frame.height - frame.diameter) < .1);
        assert.ok(rebound, 'the dot rebounds at heading ' + (i + 1));
        assert.ok(settled, 'the dot becomes round at heading ' + (i + 1));
        squashes.push(squash);
      }

      async function jump(top) {
        return page.evaluate(async top => {
          scrollTo({ top, behavior: 'instant' });
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const { x, y, width, height } = document.querySelector('.repro-section-dot i').getBoundingClientRect();
          return { x: x + width / 2, y: y + height / 2, width, height };
        }, top);
      }
      for (const squash of squashes.toReversed()) {
        await jump(0);
        await jump(1e6);
        const reverse = await jump(squash.top);
        for (const key of ['x', 'y', 'width', 'height']) near(reverse[key], squash[key], .05);
      }
      if (screenshots) {
        await jump(squashes[1].top);
        await page.screenshot({ path: join(screenshots, 'desktop-heading-morph.png'), scale: 'css' });
      }
      const resized = { width: 1024, height: 700 };
      await page.setViewportSize(resized);
      const atNewSize = await jump(squashes[1].top);
      await jump(0);
      await jump(1e6);
      const afterScrub = await jump(squashes[1].top);
      for (const key of ['x', 'y', 'width', 'height']) near(afterScrub[key], atNewSize[key], .05);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reduced = await jump(squashes[1].top);
      near(reduced.width, reduced.height, .05);
    } finally {
      await page.close();
    }
  });

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
