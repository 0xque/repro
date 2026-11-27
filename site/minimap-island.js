import { createElement, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { LineMinimap } from 'line-minimap-react';
import 'line-minimap-react/styles.css';
import 'lenis/dist/lenis.css';
import './minimap-theme.css';
import { createMinimapScroll } from './minimap-scroll.js';

function ReadingMinimap() {
  const scroll = useRef(null);
  useEffect(() => {
    const controller = createMinimapScroll();
    scroll.current = controller;
    return () => {
      scroll.current = null;
      controller.dispose();
    };
  }, []);
  const onSeek = useCallback((request) => {
    if (scroll.current) scroll.current.seek(request);
    else window.scrollTo({ top: request.top, behavior: request.immediate ? 'instant' : 'smooth' });
  }, []);
  return createElement(LineMinimap, {
    label: 'REPRO article reading progress',
    className: 'repro-minimap',
    onSeek,
  });
}

createRoot(document.getElementById('minimap-island')).render(createElement(ReadingMinimap));
