const outline = Array.from({ length: 28 }, (_, index) => {
  const angle = index * Math.PI * 2 / 28;
  return [Math.cos(angle), Math.sin(angle)];
});

const pulse = (time, start, end) =>
  time > start && time < end ? Math.sin(Math.PI * (time - start) / (end - start)) ** 2 : 0;

export function markerShape({ phase, direction = 1, strength = 1 }) {
  if (phase <= 0 || phase >= 1 || strength <= 0) return null;

  // A pulled neck folds into the landing, then the mass rolls back across the body.
  const pull = strength * pulse(phase, 0, .53);
  const fold = strength * pulse(phase, .25, .76);
  const slosh = strength * pulse(phase, .51, 1);
  const points = outline.map(([x, y]) => {
    const neck = .56 * pull * y;
    const crease = .6 * fold * Math.max(0, -direction * x) * Math.max(0, 1 - Math.abs(y + .26));
    const bend = direction * (.4 * pull * y + .49 * fold * (y ** 2 - .4) - .32 * slosh * y);
    const wide = 1 + neck - crease + .3 * slosh * (2 * y ** 2 - 1);
    return [x * wide + bend, y + direction * x * (1 - y ** 2) * (.12 * fold - .23 * slosh)];
  });

  // Fit the contour to the marker's box so its lowest point still meets the measured rule.
  const horizontal = points.map(([x]) => x);
  const vertical = points.map(([, y]) => y);
  const minX = Math.min(...horizontal), spanX = Math.max(...horizontal) - minX;
  const minY = Math.min(...vertical), spanY = Math.max(...vertical) - minY;
  const contour = points.map(([x, y]) =>
    `${((x - minX) / spanX * 100).toFixed(1)}% ${((y - minY) / spanY * 100).toFixed(1)}%`);

  return { clip: `polygon(${contour.join(',')})`, stretch: .7 * pull + .2 * slosh };
}
