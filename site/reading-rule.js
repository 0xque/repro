const mix = (from, to, weight) => from + (to - from) * weight;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function mountReadingRule(ruler) {
  if (!ruler) return;
  const root = document.documentElement;
  const scroller = document.scrollingElement || root;
  const rule = document.querySelector('.repro-reading-rule');
  const footer = rule.parentElement;
  const tab = rule.querySelector('a');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let geometry;
  const interpolate = (t) => t * t * (3 - 2 * t);

  function measure() {
    const height = root.clientHeight;
    const endY = Math.max(0, height - footer.getBoundingClientRect().height);
    // On wide, short screens leave space below the last tick for the descent.
    ruler.style.setProperty('--ruler-limit', Math.max(16, endY - 16) + 'px');
    const rail = ruler.getBoundingClientRect();
    geometry = { height, endY, left: rail.left, top: rail.top, travel: Math.max(0, rail.height - 1),
      width: root.clientWidth, tabWidth: tab.getBoundingClientRect().width };
  }

  function paint() {
    frame = 0;
    if (!geometry) measure();
    const { height, endY, left, top, travel, width, tabWidth } = geometry;
    const distance = Math.max(0, scroller.scrollHeight - height);
    const remaining = Math.max(0, distance - scroller.scrollTop);
    const tracking = remaining > .5;
    const handoff = Math.min(clamp(height * .28, 72, 200), distance * .65);
    const progress = !tracking ? 1 : motion.matches ? 0 : interpolate(clamp(1 - remaining / handoff, 0, 1));

    if (tracking) {
      const guideY = clamp(top + travel * clamp(scroller.scrollTop / distance, 0, 1), 0, height - 45);
      const x = mix(left, 0, progress);
      const right = mix(width - left, width, progress);
      const y = mix(guideY, endY, progress);
      const tabCenter = mix(right - tabWidth / 2, width / 2, progress);
      rule.style.setProperty('--rule-x', x + 'px');
      rule.style.setProperty('--rule-y', y + 'px');
      rule.style.setProperty('--rule-width', right - x);
      rule.style.setProperty('--tab-x', tabCenter - x + 'px');
    }

    ruler.style.setProperty('--ruler-handoff', progress);
    rule.toggleAttribute('data-tracking', tracking);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function resize() {
    geometry = undefined;
    schedule();
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', resize);
  window.addEventListener('pageshow', resize);
  motion.addEventListener('change', schedule);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(footer);
  observer?.observe(tab);
  observer?.observe(root);
  paint();

  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pageshow', resize);
    motion.removeEventListener('change', schedule);
    ruler.style.removeProperty('--ruler-handoff');
    ruler.style.removeProperty('--ruler-limit');
    rule.removeAttribute('data-tracking');
  };
}
