'use client';

import { createElement, useEffect, useRef } from 'react';

export function LineMinimap({ scrollTarget, label, className, style, onSeek } = {}) {
  const rail = useRef(null);

  useEffect(() => {
    void import('./line-minimap.js');
  }, []);

  useEffect(() => {
    if (!onSeek) return;
    const element = rail.current;
    const handleSeek = (event) => {
      event.preventDefault();
      onSeek(event.detail);
    };
    element.addEventListener('minimap-seek', handleSeek);
    return () => element.removeEventListener('minimap-seek', handleSeek);
  }, [scrollTarget, onSeek]);

  return createElement('line-minimap', {
    key: scrollTarget ?? null,
    ref: rail,
    'scroll-target': scrollTarget,
    'label': label,
    className,
    style,
  });
}
