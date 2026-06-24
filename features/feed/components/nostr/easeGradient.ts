/**
 * Easing gradient utilities for smooth gradient overlays.
 *
 * Adapted from https://github.com/phamfoo/react-native-easing-gradient (MIT)
 */

// eslint-disable-next-line no-restricted-imports -- This MIT adaptation drives RN's
// internal `Animated.Interpolation.__createInterpolation` color-interpolation API
// (used below for gradient color stops); Reanimated has no equivalent, so the raw
// `Animated`/`Easing` imports are load-bearing here, not a legacy-animation smell.
import { Animated, Easing, type EasingFunction } from 'react-native';

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

  return {
    colors: colors as [string, string, ...string[]],
    locations: locations as [number, number, ...number[]],
  };
}
