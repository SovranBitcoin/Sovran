/**
 * Continuous-corner ("squircle") container.
 *
 * iOS (this file): plain RN View — call sites keep `borderCurve:
 * 'continuous'` in their styles, which iOS renders natively at zero cost.
 * Android (index.android.ts): react-native-fast-squircle, a Fabric view that
 * clips/strokes along the same smooth-corner path borderCurve produces on
 * iOS (cornerSmoothing 0.6 ≈ Apple's curve, the library default).
 *
 * Use for visible rounded-square geometry (cards, large buttons). Pills and
 * circles gain nothing from corner smoothing — keep plain View there.
 */
export { View as SquircleView } from 'react-native';
export type { ViewProps as SquircleViewProps } from 'react-native';
