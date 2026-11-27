import { ease, mix, unit } from './section-marker.js';

export function measureSpecimen(proof, scrollTop) {
  const row = proof.getBoundingClientRect();
  const filename = proof.querySelector('.filename').getBoundingClientRect();
  const border = Number.parseFloat(getComputedStyle(proof).borderBottomWidth);
  return {
    x: row.left - 15,
    y: filename.top + filename.height / 2 + scrollTop,
    right: row.right,
    border,
    borderY: row.bottom - border + scrollTop,
  };
}

export function specimenTiming(specimen, { distance, handoff, rail, height, diameter, first }) {
  if (!distance || !specimen.border || !diameter) return null;
  const maxY = height - 45;
  const speed = (rail.height - 1) / distance;
  // The guide descends as the row rises. Their intersection is the contact frame.
  const contact = Math.max((specimen.borderY - rail.top) / (1 + speed), specimen.borderY - maxY);
  const end = Math.min(contact + 145, distance - handoff);
  if (contact < 18 || end <= contact) return null;
  const firstClear = (first.y + diameter / 2 - rail.top) / (1 + speed);
  const start = Math.max(0, contact - 92, firstClear);
  if (start >= contact) return null;
  const duration = end - contact;
  return { start, contact, end, speed, maxY, settledAt: contact + duration * 60 / 145,
    releaseAt: contact + duration * 75 / 145 };
}

export function specimenSpring(specimen, timing, { scrollTop, rail, diameter, marker }) {
  const { start, contact, end, speed, maxY, settledAt, releaseAt } = timing;
  if (scrollTop <= start || scrollTop >= end) return null;
  const guide = Math.max(0, Math.min(rail.top + speed * scrollTop, maxY));
  const approach = unit((scrollTop - start) / (contact - start));
  const release = ease((scrollTop - releaseAt) / (end - releaseAt));
  const borderY = specimen.borderY - scrollTop;
  const locked = scrollTop >= contact && scrollTop <= releaseAt;
  const y = scrollTop < contact ? guide : mix(borderY, guide, release);

  if (scrollTop < contact) {
    const drop = approach ** 2;
    return {
      y, locked, extension: ease(approach), thickness: 1,
      marker: {
        x: mix(marker.x, specimen.x, ease(approach)) - 8 * Math.sin(Math.PI * ease(approach)),
        y: mix(marker.y + scrollTop - start, guide - diameter / 2, drop),
        scaleY: mix(marker.scaleY, 1, ease(approach)),
        deformation: { phase: .52 * approach },
      },
    };
  }

  const time = unit((scrollTop - contact) / (settledAt - contact));
  const compression = .34 * Math.sin(Math.PI * unit(time / .22));
  const scaleY = 1 - compression;
  const settleClearance = Math.max(0, specimen.borderY - specimen.y - diameter / 2);
  const peak = settleClearance + 10;
  const clearance = time < .58
    ? peak * ease((time - .22) / .36)
    : mix(peak, settleClearance, ease((time - .58) / .42));
  const dockedMarkerY = borderY - clearance - diameter * scaleY / 2;

  return {
    y, locked, extension: 1 - release, thickness: mix(specimen.border, 1, release),
    marker: {
      x: mix(specimen.x, marker.x, release),
      y: mix(dockedMarkerY, marker.y, release),
      scaleY: mix(scaleY, marker.scaleY, release),
      deformation: { phase: .52 + .48 * time },
    },
  };
}
