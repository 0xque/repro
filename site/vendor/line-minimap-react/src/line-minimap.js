const TICK_COUNT = 36;
const MAJOR_INTERVAL = 7;
const MAGNIFICATION_RADIUS = 6;
const MIN_FLARE_SPEED = 0.9;
const MAX_FLARE_SPEED = 2.2;
const FAST_SAMPLES_REQUIRED = 3;
const SCROLL_SAMPLE_WINDOW = 65;
const FLARE_IDLE_DELAY = 110;
const RANGE_MAX = 1000;
const clamp = (value) => Math.min(1, Math.max(0, value));
const tickSpread = (index, center) =>
  Math.max(0, 1 - Math.abs(index - center) / MAGNIFICATION_RADIUS) ** 2;

class LineMinimap extends HTMLElement {
  static observedAttributes = ['label'];

  #track;
  #range;
  #readout;
  #ticks;
  #scroller;
  #scrollSource;
  #resizeObserver;
  #listeners;
  #frame = 0;
  #hoverPosition = null;
  #paintedTicks;
  #lastScrollTop = 0;
  #lastScrollTime = -Infinity;
  #fastScrollSamples = 0;
  #scrollFlare = 0;
  #flareTimer = 0;
  #drag = null;
  #motion = matchMedia('(prefers-reduced-motion: reduce)');

  attributeChangedCallback() {
    this.#range?.setAttribute('aria-label', this.getAttribute('label') || 'Reading progress');
  }

  connectedCallback() {
    if (!this.#track) this.#render();

    const targetId = this.getAttribute('scroll-target');
    const target = targetId ? this.ownerDocument.getElementById(targetId) : null;
    this.#scroller = target ?? this.ownerDocument.scrollingElement;
    this.#scrollSource = target ?? this.ownerDocument;
    this.#lastScrollTop = this.#scroller.scrollTop;
    this.#lastScrollTime = -Infinity;
    this.#fastScrollSamples = 0;
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;

    this.#scrollSource.addEventListener('scroll', this.#onScroll, { passive: true, signal });
    window.addEventListener('resize', this.#schedule, { passive: true, signal });
    this.#motion.addEventListener('change', this.#schedule, { signal });
    this.#resizeObserver = new ResizeObserver(this.#schedule);
    this.#resizeObserver.observe(this.#scroller);
    if (!target && this.ownerDocument.body !== this.#scroller) {
      this.#resizeObserver.observe(this.ownerDocument.body);
    }

    this.#range.addEventListener('input', () => {
      this.#seek(this.#range.valueAsNumber / RANGE_MAX, true);
    }, { signal });
    this.#range.addEventListener('keydown', this.#onKeyDown, { signal });

    this.#range.addEventListener('pointerdown', this.#onPointerDown, { signal });
    this.#range.addEventListener('pointermove', this.#onPointerMove, { signal });
    this.#range.addEventListener('pointerup', this.#onPointerUp, { signal });
    this.#range.addEventListener('pointercancel', this.#clearDrag, { signal });
    this.#range.addEventListener('lostpointercapture', this.#clearDrag, { signal });
    this.#range.addEventListener('pointerleave', () => {
      if (!this.#drag) {
        this.#hoverPosition = null;
        this.#schedule();
      }
    }, { signal });

    this.#paint();
  }

  disconnectedCallback() {
    this.#listeners?.abort();
    this.#resizeObserver?.disconnect();
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#flareTimer);
    this.#frame = 0;
    this.#scrollFlare = 0;
    this.#drag = null;
    this.#hoverPosition = null;
  }

  #render() {
    this.innerHTML = `
      <div class="line-minimap__track">
        <div class="line-minimap__ticks" aria-hidden="true"></div>
        <div class="line-minimap__guide" aria-hidden="true"><span>0%</span></div>
        <input class="line-minimap__range" type="range" min="0" max="${RANGE_MAX}" value="0"
          aria-label="Reading progress" aria-orientation="vertical">
      </div>`;

    this.#track = this.querySelector('.line-minimap__track');
    this.#range = this.querySelector('.line-minimap__range');
    this.attributeChangedCallback();
    this.#readout = this.querySelector('.line-minimap__guide span');
    const tickList = this.querySelector('.line-minimap__ticks');
    this.#ticks = Array.from({ length: TICK_COUNT }, (_, index) => {
      const tick = document.createElement('span');
      if (index % MAJOR_INTERVAL === 0) tick.className = 'line-minimap__major';
      tickList.append(tick);
      return tick;
    });
  }

  #schedule = () => {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#paint);
  };

  #onScroll = () => {
    const top = Math.max(0, this.#scroller.scrollTop);
    const now = performance.now();
    const elapsed = now - this.#lastScrollTime;
    const speed = elapsed <= SCROLL_SAMPLE_WINDOW && !this.#drag && !this.#motion.matches
      ? Math.abs(top - this.#lastScrollTop) / Math.max(16, elapsed)
      : 0;
    this.#lastScrollTop = top;
    this.#lastScrollTime = now;

    this.#fastScrollSamples = speed > MIN_FLARE_SPEED
      ? Math.min(this.#fastScrollSamples + 1, FAST_SAMPLES_REQUIRED)
      : 0;
    clearTimeout(this.#flareTimer);
    this.#scrollFlare = this.#fastScrollSamples === FAST_SAMPLES_REQUIRED
      ? clamp((speed - MIN_FLARE_SPEED) / (MAX_FLARE_SPEED - MIN_FLARE_SPEED))
      : 0;
    if (this.#scrollFlare) {
      this.#flareTimer = setTimeout(() => {
        this.#scrollFlare = 0;
        this.#schedule();
      }, FLARE_IDLE_DELAY);
    }
    this.#schedule();
  };

  #paint = () => {
    this.#frame = 0;
    const distance = this.#scrollDistance();
    const progress = distance > 0 ? clamp(this.#scroller.scrollTop / distance) : 0;
    const percent = progress === 1 ? 100 : Math.min(99, Math.round(progress * 100));

    this.toggleAttribute('data-idle', distance === 0);
    this.style.setProperty('--minimap-progress', progress);
    this.#range.value = Math.round(progress * RANGE_MAX);
    const description = `${percent}% read`;
    if (this.#range.getAttribute('aria-valuetext') !== description) {
      this.#range.setAttribute('aria-valuetext', description);
      this.#readout.textContent = `${percent}%`;
    }

    this.#paintTicks(progress);
  };

  #paintTicks(progress) {
    const reducedMotion = this.#motion.matches;
    const flare = reducedMotion || this.#drag ? 0 : this.#scrollFlare;
    const flareIndex = flare ? progress * (TICK_COUNT - 1) : -Infinity;
    const state = `${this.#hoverPosition}/${reducedMotion}/${flareIndex}/${flare}`;
    if (state === this.#paintedTicks) return;
    this.#paintedTicks = state;

    const hoveredIndex = this.#hoverPosition === null ? -Infinity : this.#hoverPosition * (TICK_COUNT - 1);
    const nearest = Math.round(hoveredIndex);
    this.#ticks.forEach((tick, index) => {
      const spread = Math.max(tickSpread(index, hoveredIndex), flare * tickSpread(index, flareIndex));
      const scale = reducedMotion ? 1 : 1 + 1.85 * spread;
      tick.style.setProperty('--tick-scale', scale.toFixed(3));
      tick.classList.toggle('line-minimap__nearest', index === nearest);
    });
  }

  #scrollDistance() {
    return Math.max(0, this.#scroller.scrollHeight - this.#scroller.clientHeight);
  }

  #seek(progress, animate) {
    const top = clamp(progress) * this.#scrollDistance();
    const immediate = !animate || this.#motion.matches;
    const useNativeScroll = this.dispatchEvent(new CustomEvent('minimap-seek', {
      cancelable: true,
      detail: { top, immediate },
    }));
    if (useNativeScroll) {
      this.#scroller.scrollTo({ top, behavior: immediate ? 'instant' : 'smooth' });
    }
    if (immediate) this.#lastScrollTop = this.#scroller.scrollTop;
    this.#schedule();
  }

  #pointerPosition(event) {
    const rect = this.#track.getBoundingClientRect();
    return clamp((event.clientY - rect.top) / rect.height);
  }

  #onPointerDown = (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    this.#range.focus({ preventScroll: true });
    this.#range.setPointerCapture(event.pointerId);
    this.#drag = { pointerId: event.pointerId, startY: event.clientY, moved: false };
    this.#hoverPosition = this.#pointerPosition(event);
    this.#schedule();
  };

  #onPointerMove = (event) => {
    if (!event.isPrimary) return;
    const progress = this.#pointerPosition(event);
    this.#hoverPosition = progress;
    if (this.#drag?.pointerId === event.pointerId) {
      this.#drag.moved ||= Math.abs(event.clientY - this.#drag.startY) >= 4;
      if (this.#drag.moved) this.#seek(progress, false);
    }
    this.#schedule();
  };

  #onPointerUp = (event) => {
    if (this.#drag?.pointerId !== event.pointerId) return;
    this.#seek(this.#pointerPosition(event), !this.#drag.moved);
    this.#clearDrag(event);
    if (event.pointerType === 'mouse') {
      const rect = this.#range.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) {
        this.#hoverPosition = this.#pointerPosition(event);
      }
    }
  };

  #clearDrag = (event) => {
    if (this.#drag?.pointerId !== event.pointerId) return;
    this.#drag = null;
    this.#hoverPosition = null;
    this.#schedule();
  };

  #onKeyDown = (event) => {
    const distance = this.#scrollDistance();
    if (!distance) return;
    const progress = this.#scroller.scrollTop / distance;
    const increment = 1 / (TICK_COUNT - 1);
    const destinations = {
      ArrowDown: progress + increment,
      ArrowRight: progress + increment,
      ArrowUp: progress - increment,
      ArrowLeft: progress - increment,
      PageDown: progress + 0.1,
      PageUp: progress - 0.1,
      Home: 0,
      End: 1,
    };
    if (!Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    this.#seek(destinations[event.key], false);
  };
}

if (!customElements.get('line-minimap')) {
  customElements.define('line-minimap', LineMinimap);
}
