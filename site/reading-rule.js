import { markerShape } from './marker-shape.js';
import { measureSpecimen, specimenSpring, specimenTiming } from './specimen-spring.js';
import { ease, markerAt, markerEntrance, measureMarker, mix, unit } from './section-marker.js';

export function mountReadingRule(ruler) {
  if (!ruler) return;
  const root = document.documentElement;
  const scroller = document.scrollingElement || root;
  const article = document.getElementById('intro');
  const proof = document.getElementById('file');
  const dot = article.querySelector('.repro-section-dot');
  const rule = document.querySelector('.repro-reading-rule');
  const footer = rule.parentElement;
  const pocket = matchMedia('(max-width:600px)');
  const compact = matchMedia('(max-width:1050px), (max-height:520px)');
  const editorial = matchMedia('(min-width:1850px) and (min-aspect-ratio:2/1)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const viewport = window.visualViewport;
  let frame = 0;
  let geometry;
  let entranceClock;
  let defaultOpen = proof.open;
  let proofTouched = proof.open;

  function syncProof() {
    // The native toggle notification can arrive after a resize.
    if (proof.open !== defaultOpen) proofTouched = true;
    if (!proofTouched && (editorial.matches || !proof.contains(document.activeElement))) {
      defaultOpen = editorial.matches;
      proof.open = defaultOpen;
    }
  }

  function onProofToggle() {
    if (proof.open !== defaultOpen) proofTouched = true;
    resize();
  }

  function measure() {
    const height = root.clientHeight;
    const width = root.clientWidth;
    const rail = ruler.getBoundingClientRect();
    const { left, right, top } = article.getBoundingClientRect();
    const scrollTop = scroller.scrollTop;
    const articleTop = top + scrollTop;
    const specimen = measureSpecimen(proof, scrollTop);
    const targets = measureMarker(article, scrollTop, height);
    const endY = Math.max(0, height - footer.getBoundingClientRect().height);
    // The wordmark reserves room for the larger label after docking.
    const tabWidth = 9 * Number.parseFloat(getComputedStyle(root).fontSize);
    const compactTab = compact.matches || width - right < tabWidth + 24;
    geometry = { height, width, rail, left, right, articleTop, endY, compactTab, tabWidth, specimen, targets,
      diameter: dot.getBoundingClientRect().width };
    rule.toggleAttribute('data-compact-tab', compactTab && !pocket.matches);
  }

  function paint(now) {
    frame = 0;
    if (!geometry) measure();
    const { height, width, rail, left, right, articleTop, endY, compactTab, tabWidth, specimen, targets, diameter } = geometry;
    const scrollTop = scroller.scrollTop;
    const distance = Math.max(0, scroller.scrollHeight - height);
    const reading = distance ? unit(scrollTop / distance) : 1;
    const remaining = Math.max(0, distance - scrollTop);
    const tracking = remaining > .5;
    const handoff = Math.min(Math.max(72, Math.min(200, height * .28)), distance * .65);
    const progress = !tracking ? 1 : motion.matches ? 0 : unit(1 - remaining / handoff);
    if (pocket.matches) rule.style.setProperty('--pocket-progress', reading);
    else ruler.style.setProperty('--ruler-handoff', ease(progress));

    const animated = !pocket.matches && !motion.matches;
    const timing = animated && !proof.open
      ? specimenTiming(specimen, { distance, handoff, rail, height, diameter, first: targets.first })
      : null;
    const marker = markerAt(targets, scrollTop, diameter, animated, timing);
    const spring = timing && specimenSpring(specimen, timing, { scrollTop, rail, diameter, marker });
    rule.toggleAttribute('data-specimen-docked', !!spring?.locked);
    dot.toggleAttribute('data-specimen-spring', !!spring);
    if (pocket.matches) entranceClock = null;
    else {
      const entranceLimit = Math.max(16, Math.min(56, timing?.start ?? 56));
      paintMarker(spring?.marker ?? marker, { scrollTop, now, animated, entranceLimit, floor: spring?.y });
    }
    if (tracking && !pocket.matches) {
      const guideY = Math.max(0, Math.min(rail.top + (rail.height - 1) * reading, height - 45));
      const gutterStart = compactTab ? 5 : rail.left;
      const gutterEnd = compactTab ? 49 : Math.max(right + tabWidth + 8, width - rail.left);
      // Move through the gutter first. Sweep across only after reaching the live footer seam.
      const descent = ease(progress * 2);
      const sweep = ease(progress * 2 - 1);
      const seam = Math.min(endY + remaining, height - 45);
      const y = spring?.y ?? mix(guideY, seam, descent);
      const guideOrigin = rail.top + (rail.height - 1) * reading;
      ruler.style.setProperty('--specimen-guide-offset', (spring ? y - guideOrigin : 0) + 'px');
      const x = mix(gutterStart, 0, sweep);
      const end = mix(Math.min(gutterEnd, width - 4), width, sweep);
      const ruleEnd = spring ? mix(end, Math.max(end, specimen.right), spring.extension) : end;
      const span = ruleEnd - x;
      rule.style.setProperty('--rule-x', x + 'px');
      rule.style.setProperty('--rule-y', y + 'px');
      rule.style.setProperty('--rule-width', span);
      rule.style.setProperty('--rule-thickness', (spring?.thickness ?? 1) + 'px');
      rule.style.setProperty('--specimen-extension', spring?.extension ?? 0);
      rule.style.setProperty('--tab-shift', sweep);
      rule.style.setProperty('--tab-anchor', mix(Math.min(gutterEnd, width - 4), width / 2, sweep) - x + 'px');
    }
    rule.toggleAttribute('data-tracking', tracking);
  }

  function paintMarker(marker, { scrollTop, now, animated, entranceLimit, floor }) {
    const { left, articleTop, diameter } = geometry;
    if (entranceClock === undefined) entranceClock = animated && scrollTop < 2 ? { last: now, elapsed: 0 } : null;
    if (entranceClock && animated && scrollTop < entranceLimit) {
      // A stalled frame must not skip the stretch and fold.
      entranceClock.elapsed += Math.min(45, now - entranceClock.last);
      entranceClock.last = now;
    } else entranceClock = null;

    let y = marker.y;
    let scaleY = marker.scaleY;
    let opacity = 1;
    let deformation = marker.deformation;
    if (entranceClock && entranceClock.elapsed < 530) {
      const entrance = markerEntrance(entranceClock.elapsed);
      const weight = 1 - ease(scrollTop / entranceLimit);
      y += entrance.offset * weight;
      scaleY *= mix(1, entrance.scaleY, weight);
      opacity = mix(1, entrance.opacity, weight);
      if (floor !== undefined) y = Math.min(y, floor - diameter * scaleY / 2);
      deformation = deformation
        ? { ...deformation, phase: mix(deformation.phase, entrance.phase, weight) }
        : { phase: entrance.phase, strength: weight };
      schedule();
    } else entranceClock = null;

    const shape = deformation && markerShape(deformation);
    const stretch = 1 + (shape?.stretch ?? 0);
    const scaleX = (1 + (1 - scaleY) * .85) / Math.sqrt(stretch);
    y -= diameter * scaleY * (stretch - 1) / 2;
    scaleY *= stretch;

    dot.style.setProperty('--dot-x', marker.x - left - diameter / 2 + 'px');
    dot.style.setProperty('--dot-y', y - articleTop + scrollTop - diameter / 2 + 'px');
    dot.style.setProperty('--dot-scale-y', scaleY);
    dot.style.setProperty('--dot-scale-x', scaleX);
    dot.style.setProperty('--dot-clip', shape?.clip ?? 'none');
    dot.style.setProperty('--dot-radius', shape ? '0' : '50%');
    dot.style.setProperty('--dot-opacity', opacity);
    dot.setAttribute('data-positioned', '');
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function resize() {
    if (viewport) ruler.style.setProperty('--ruler-center', viewport.offsetTop + viewport.height / 2 + 'px');
    geometry = undefined;
    schedule();
  }

  function reflow() {
    syncProof();
    resize();
  }

  root.setAttribute('data-reading-rule-ready', '');
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', reflow);
  window.addEventListener('pageshow', reflow);
  viewport?.addEventListener('resize', resize);
  viewport?.addEventListener('scroll', resize);
  motion.addEventListener('change', schedule);
  document.fonts?.ready.then(() => {
    if (root.hasAttribute('data-reading-rule-ready')) resize();
  });
  proof.addEventListener('toggle', onProofToggle);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(article);
  observer?.observe(footer);
  observer?.observe(root);
  reflow();

  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', reflow);
    window.removeEventListener('pageshow', reflow);
    viewport?.removeEventListener('resize', resize);
    viewport?.removeEventListener('scroll', resize);
    motion.removeEventListener('change', schedule);
    proof.removeEventListener('toggle', onProofToggle);
    ruler.style.removeProperty('--ruler-handoff');
    ruler.style.removeProperty('--ruler-center');
    ruler.style.removeProperty('--specimen-guide-offset');
    dot.removeAttribute('data-specimen-spring');
    dot.removeAttribute('data-positioned');
    rule.removeAttribute('data-specimen-docked');
    rule.removeAttribute('data-tracking');
    root.removeAttribute('data-reading-rule-ready');
  };
}
