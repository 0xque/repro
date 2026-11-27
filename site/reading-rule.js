const mix = (from, to, weight) => from + (to - from) * weight;
const unit = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

export function mountReadingRule(ruler) {
  if (!ruler) return;
  const root = document.documentElement;
  const scroller = document.scrollingElement || root;
  const article = document.getElementById('intro');
  const proof = document.getElementById('file');
  const rule = document.querySelector('.repro-reading-rule');
  const footer = rule.parentElement;
  const pocket = matchMedia('(max-width:600px)');
  const compact = matchMedia('(max-width:1050px), (max-height:520px)');
  const editorial = matchMedia('(min-width:1850px) and (min-aspect-ratio:2/1)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const viewport = window.visualViewport;
  let frame = 0;
  let geometry;
  let defaultOpen = proof.open;
  let proofTouched = proof.open;

  function syncProof() {
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
    const { left, right } = article.getBoundingClientRect();
    const endY = Math.max(0, height - footer.getBoundingClientRect().height);
    // The wordmark reserves room for the larger label after docking.
    const tabWidth = 9 * Number.parseFloat(getComputedStyle(root).fontSize);
    const compactTab = compact.matches || width - right < tabWidth + 24;
    geometry = { height, width, rail, left, right, endY, compactTab, tabWidth };
    rule.toggleAttribute('data-compact-tab', compactTab && !pocket.matches);
  }

  function paint() {
    frame = 0;
    if (!geometry) measure();
    const { height, width, rail, left, right, endY, compactTab, tabWidth } = geometry;
    const distance = Math.max(0, scroller.scrollHeight - height);
    const reading = distance ? unit(scroller.scrollTop / distance) : 1;
    const remaining = Math.max(0, distance - scroller.scrollTop);
    const tracking = remaining > .5;
    const handoff = Math.min(Math.max(72, Math.min(200, height * .28)), distance * .65);
    const progress = !tracking ? 1 : motion.matches ? 0 : unit(1 - remaining / handoff);
    if (pocket.matches) rule.style.setProperty('--pocket-progress', reading);
    else ruler.style.setProperty('--ruler-handoff', ease(progress));

    if (tracking && !pocket.matches) {
      const guideY = Math.max(0, Math.min(rail.top + (rail.height - 1) * reading, height - 45));
      const gutterStart = compactTab ? 5 : rail.left;
      const gutterEnd = compactTab ? 49 : Math.max(right + tabWidth + 8, width - rail.left);
      // Move through the gutter first. Sweep across only after reaching the live footer seam.
      const descent = ease(progress * 2);
      const sweep = ease(progress * 2 - 1);
      const seam = Math.min(endY + remaining, height - 45);
      const y = mix(guideY, seam, descent);
      const x = mix(gutterStart, 0, sweep);
      const end = mix(Math.min(gutterEnd, width - 4), width, sweep);
      const span = end - x;
      rule.style.setProperty('--rule-x', x + 'px');
      rule.style.setProperty('--rule-y', y + 'px');
      rule.style.setProperty('--rule-width', span);
      rule.style.setProperty('--tab-shift', sweep);
      rule.style.setProperty('--tab-anchor', mix(Math.min(gutterEnd, width - 4), width / 2, sweep) - x + 'px');
      rule.style.setProperty('--rule-gap-start', 100 * unit((left - 8 - x) / span) + '%');
      rule.style.setProperty('--rule-gap-end', 100 * unit((right + 8 - x) / span) + '%');
    }
    rule.toggleAttribute('data-tracking', tracking);
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
    rule.removeAttribute('data-tracking');
    root.removeAttribute('data-reading-rule-ready');
  };
}
