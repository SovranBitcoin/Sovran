/**
 * Android half of the SquircleView primitive — see index.ts. Renders
 * react-native-fast-squircle (Fabric) so `borderRadius` corners follow the
 * same continuous curve `borderCurve: 'continuous'` produces on iOS.
 * Styles (radius, borders, shadows, overflow) pass through unchanged.
 */
import FastSquircleView from 'react-native-fast-squircle';

export const SquircleView = FastSquircleView;
export type { FastSquircleViewProps as SquircleViewProps } from 'react-native-fast-squircle';
