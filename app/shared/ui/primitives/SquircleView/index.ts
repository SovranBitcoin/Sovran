/**
 * Continuous-corner ("squircle") container: a plain RN View on both platforms.
 *
 * Call sites keep `borderCurve: 'continuous'` in their styles, which iOS
 * renders natively at zero cost; Android ignores it and draws the same
 * `borderRadius` as an ordinary circular corner.
 *
 * Use for visible rounded-square geometry (cards, large buttons). Pills and
 * circles gain nothing from corner smoothing — keep plain View there.
 */
export { View as SquircleView } from 'react-native';
