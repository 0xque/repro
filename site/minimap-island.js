import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LineMinimap } from 'line-minimap-react';
import 'line-minimap-react/styles.css';
import './minimap-theme.css';

const root = document.getElementById('minimap-island');
createRoot(root).render(createElement(LineMinimap, {
  label: 'REPRO article reading progress',
  className: 'repro-minimap',
}));
