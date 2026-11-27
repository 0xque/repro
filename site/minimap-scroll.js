import Lenis from 'lenis';

export function createMinimapScroll(page = window, LenisClass = Lenis) {
  const motion = page.matchMedia('(prefers-reduced-motion: reduce)');
  let lenis;
  let offWheel;
  let frame = 0;
  let timestamp = null;
  let clock = 0;

  function advance(now) {
    frame = 0;
    if (!lenis) return;
    // A bounded active clock avoids jumping ahead after an idle tab or long pause.
    clock += timestamp === null ? 16.67 : Math.min(40, Math.max(0, now - timestamp));
    timestamp = now;
    lenis.raf(clock);
    if (lenis.isScrolling === 'smooth') requestFrame();
    else timestamp = null;
  }

  function requestFrame() {
    if (lenis && !frame) frame = page.requestAnimationFrame(advance);
  }

  function stop() {
    if (frame) page.cancelAnimationFrame(frame);
    frame = 0;
    timestamp = null;
    clock = 0;
    offWheel?.();
    offWheel = undefined;
    lenis?.destroy();
    lenis = undefined;
  }

  function start() {
    if (motion.matches) {
      stop();
      return;
    }
    if (lenis) return;
    lenis = new LenisClass({
      smoothWheel: true,
      syncTouch: false,
      autoRaf: false,
      autoResize: false,
      naiveDimensions: true,
      anchors: false,
      lerp: 0.14,
    });
    offWheel = lenis.on('virtual-scroll', ({ event, deltaY }) => {
      if (event.type === 'wheel' && !event.ctrlKey && deltaY) requestFrame();
    });
  }

  motion.addEventListener('change', start);
  page.addEventListener('pagehide', stop);
  page.addEventListener('pageshow', start);
  start();

  return {
    seek({ top, immediate }) {
      if (!Number.isFinite(top)) return;
      if (!lenis) {
        page.scrollTo({ top, behavior: immediate || motion.matches ? 'instant' : 'smooth' });
        return;
      }
      lenis.scrollTo(top, { immediate });
      if (!immediate) requestFrame();
    },
    dispose() {
      motion.removeEventListener('change', start);
      page.removeEventListener('pagehide', stop);
      page.removeEventListener('pageshow', start);
      stop();
    },
  };
}
