/**
 * Eased colour stops for gradient overlays: given sparse stops, returns the
 * densely-sampled `colors` / `locations` arrays `expo-linear-gradient` wants,
 * interpolated along an easing curve instead of linearly.
 *
 * Adapted from https://github.com/phamfoo/react-native-easing-gradient (MIT).
 * That package was also installed, so the app carried two copies of this
 * function; this one won because it returns the non-empty tuples
 * `LinearGradient` requires and guards against a missing stop.
 */

// Reanimated is the house animation library and `Animated`/`Easing` are banned
// in its favour, but nothing here animates: this reaches into
// `Animated.Interpolation.__createInterpolation` purely as a colour-space
// interpolator, called at module scope to precompute static gradient stops.
// Reanimated has no equivalent colour interpolator usable off the UI thread.
// eslint-disable-next-line no-restricted-imports
import { Animated, Easing, type EasingFunction } from 'react-native';

import { log } from '@/shared/lib/logger';

// @ts-expect-error - internal RN API for color interpolation
const AnimatedInterpolation = Animated.Interpolation;

type ColorInterpolateFunction = (input: number) => string;

function createInterpolation(config: Animated.InterpolationConfigType): ColorInterpolateFunction {
  if (AnimatedInterpolation.__createInterpolation) {
    return AnimatedInterpolation.__createInterpolation(config);
  }
  return (input) => {
    const interpolation = new AnimatedInterpolation({ __getValue: () => input }, config);
    return interpolation.__getValue();
  };
}

interface ColorStops {
  [location: number]: {
    color: string;
    easing?: EasingFunction;
  };
}

const easeInOut = Easing.bezier(0.42, 0, 0.58, 1);

export function easeGradient({
  colorStops,
  easing = easeInOut,
  extraColorStopsPerTransition = 12,
}: {
  colorStops: ColorStops;
  extraColorStopsPerTransition?: number;
  easing?: EasingFunction;
}): {
  colors: [string, string, ...string[]];
  locations: [number, number, ...number[]];
} {
  const colors: string[] = [];
  const locations: number[] = [];

  const initialLocations = Object.keys(colorStops)
    .map((key) => Number(key))
    .sort();

  for (let i = 0; i < initialLocations.length - 1; i++) {
    const startLoc = initialLocations[i]!;
    const endLoc = initialLocations[i + 1]!;
    const startStop = colorStops[startLoc];
    const endStop = colorStops[endLoc];
    if (!startStop || !endStop) continue;

    const currentEasing = startStop.easing ?? easing;
    const colorScale = createInterpolation({
      inputRange: [0, 1],
      outputRange: [startStop.color, endStop.color],
      easing: currentEasing,
    });

    const transitionLength = endLoc - startLoc;
    const stepSize = 1 / (extraColorStopsPerTransition + 1);

    for (let step = 0; step <= extraColorStopsPerTransition + 1; step++) {
      const progress = step * stepSize;
      colors.push(colorScale(progress));
      locations.push(startLoc + transitionLength * progress);
    }
  }

  // The declared non-empty tuples are ENFORCED, not asserted: with <2 usable
  // stops (empty/malformed colorStops) the old casts fabricated a tuple over
  // an empty array — and call sites have deleted their own guards on the
  // strength of this signature. Degrade to a real 2-stop identity gradient
  // instead (LinearGradient requires ≥2 entries).
  if (colors.length < 2 || locations.length < 2) {
    log.warn('easeGradient.degenerate_stops', { colorCount: colors.length });
    const fill = colors[0] ?? 'transparent';
    const location = locations[0] ?? 0;
    return { colors: [fill, fill], locations: [location, 1] };
  }
  return {
    colors: [colors[0]!, colors[1]!, ...colors.slice(2)],
    locations: [locations[0]!, locations[1]!, ...locations.slice(2)],
  };
}
