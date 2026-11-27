export const mix = (from, to, weight) => from + (to - from) * weight;
export const unit = value => Math.max(0, Math.min(1, value));
export const ease = value => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

export function measureMarker(article, scrollTop, height) {
  const targets = [...article.querySelectorAll('main > h1, .capsule > summary, .result > h2, .workflow > h2, .field-note > h2')]
    .filter(target => target.getClientRects().length && (!target.closest('.artifact') || target.closest('details').open))
    .map(target => {
      const { left, top, height } = (target.querySelector('.filename') ?? target).getBoundingClientRect();
      const line = Number.parseFloat(getComputedStyle(target).lineHeight) || height;
      const specimen = target.matches('summary');
      const gutter = specimen ? target.getBoundingClientRect().left : left;
      return { specimen, x: Math.max(7, gutter - 15), y: top + Math.min(height, line) / 2 + scrollTop };
    });
  const entryLine = Math.min(height * .44, (targets[1]?.y ?? Infinity) - 56);
  const first = targets.shift();
  const points = targets.sort((a, b) => a.y - b.y).map(point => ({ ...point, at: point.y - entryLine }));
  return { first, points };
}

export function markerAt({ first, points }, scrollTop, diameter, animated, specimen) {
  let previous = first;
  for (const point of points) {
    // The specimen spring owns the summary's landing. The other headings start after it.
    const specimenTarget = specimen && point.specimen;
    const ready = previous === first ? 0 : previous.at + 14;
    const at = specimenTarget ? specimen.releaseAt
      : animated ? Math.max(point.at, ready + 56) : point.at;
    if (scrollTop < at && (!animated || specimenTarget)) break;
    const start = Math.max(ready, at - 72);
    if (animated && scrollTop < at) {
      const t = unit((scrollTop - start) / (at - start));
      const landing = unit(t / .58);
      const rebound = unit((t - .58) / .42);
      const scaleY = 1 - .76 * Math.sin(Math.PI * ease((t - .45) / .26));
      const lift = 9 * Math.sin(Math.PI * ease(rebound));
      return {
        x: mix(previous.x, point.x, ease(landing)),
        y: mix(previous.y, point.y, landing ** 2) - scrollTop - lift + diameter * (1 - scaleY) / 2,
        scaleY,
      };
    }
    previous = { ...point, at: specimenTarget ? specimen.end : at };
  }
  return { x: previous.x, y: previous.y - scrollTop, scaleY: 1 };
}

export function markerEntrance(time) {
  const t = unit(time / 530);
  if (t < .52) {
    const fall = t / .52;
    return { offset: mix(-25, 4, fall ** 2), scaleY: mix(1, .68, ease((fall - .84) / .16)), opacity: ease(t / .16) };
  }
  const rebound = unit((t - .52) / .48);
  const lift = 9 * Math.sin(Math.PI * ease(rebound));
  return { offset: mix(4, 0, ease(rebound)) - lift, scaleY: mix(.68, 1, ease(rebound * 4)), opacity: 1 };
}
