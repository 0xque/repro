const unit = value => Math.max(0, Math.min(1, value));
const mix = (from, to, weight) => from + (to - from) * weight;
const smooth = value => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

export function measureSpecimen(proof, article, scrollTop) {
  const row = proof.getBoundingClientRect();
  const heading = article.querySelector('h1');
  const title = heading.getBoundingClientRect();
  const filename = proof.querySelector('.filename').getBoundingClientRect();
  const border = Number.parseFloat(getComputedStyle(proof).borderBottomWidth);
  const titleLine = Number.parseFloat(getComputedStyle(heading).lineHeight);
  return {
    titleX: title.left - 15,
    titleY: title.top + titleLine / 2 + scrollTop,
    markerX: row.left - 15,
    markerY: filename.top + filename.height / 2 + scrollTop,
    right: row.right,
    border,
    borderY: row.bottom - border + scrollTop,
  };
}

export function specimenSpring(specimen, { scrollTop, distance, rail, height, diameter }) {
  if (!distance || !specimen.border || !diameter) return null;
  const maxY = height - 45;
  const speed = (rail.height - 1) / distance;
  // The guide descends as the row rises. Their intersection is the contact frame.
  const contact = Math.max((specimen.borderY - rail.top) / (1 + speed), specimen.borderY - maxY);
  if (contact < 18 || contact >= distance) return null;
  const start = Math.max(0, contact - 92);
  const settledAt = contact + 60;
  const releaseAt = settledAt + 15;
  const end = releaseAt + 70;
  if (scrollTop <= start || scrollTop >= end) return null;

  const guide = Math.max(0, Math.min(rail.top + speed * scrollTop, maxY));
  const elapsed = scrollTop - contact;
  const release = smooth((scrollTop - releaseAt) / (end - releaseAt));
  const approach = unit((scrollTop - start) / (contact - start));
  const borderY = specimen.borderY - scrollTop;
  const locked = elapsed >= 0 && scrollTop <= releaseAt;
  const y = elapsed < 0 ? guide : mix(borderY, guide, release);
  const meet = unit(approach ** 2);
  let centerX = mix(specimen.titleX, specimen.markerX, smooth(approach)) - 8 * Math.sin(Math.PI * approach);
  centerX = Math.max(diameter / 2, centerX);
  const settleClearance = Math.max(0, specimen.borderY - specimen.markerY - diameter / 2);
  let bottom = mix(Math.min(guide, specimen.titleY - scrollTop + diameter / 2), guide, meet);
  let scaleY = 1;

  if (elapsed >= 0) {
    const time = unit(elapsed / (settledAt - contact));
    const compression = .34 * Math.sin(Math.PI * unit(time / .22));
    scaleY = 1 - compression;
    const peak = settleClearance + 10;
    const clearance = time < .58
      ? peak * smooth((time - .22) / .36)
      : mix(peak, settleClearance, smooth((time - .58) / .42));
    bottom = elapsed >= settledAt ? Math.min(y, specimen.markerY - scrollTop + diameter / 2) : y - clearance;
  }

  return { y, locked, extension: smooth(approach) * (1 - release), x: centerX - diameter / 2,
    dotTop: bottom - diameter * scaleY, scaleY };
}
