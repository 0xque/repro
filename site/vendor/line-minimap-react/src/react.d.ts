import type { CSSProperties, ReactElement } from 'react';

export interface LineMinimapSeek {
  top: number;
  immediate: boolean;
}

export interface LineMinimapProps {
  /** ID of the scrollable element. Defaults to the page. */
  scrollTarget?: string;
  /** Accessible name of the slider. Defaults to Reading progress. */
  label?: string;
  className?: string;
  style?: CSSProperties & { [property: `--${string}`]: string | number | undefined };
  /** Overrides the built-in seek for clicks, drags, and keyboard navigation. */
  onSeek?: (request: LineMinimapSeek) => void;
}

export function LineMinimap(props?: LineMinimapProps): ReactElement;
