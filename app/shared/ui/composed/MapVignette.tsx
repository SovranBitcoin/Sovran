import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { withAlpha } from '@/shared/lib/color';

/**
 * Crossed edge fade for an embedded map: two gradients, horizontal and
 * vertical, opaque at the edges and near-transparent through the middle, so the
 * map dissolves into the surrounding card instead of ending on a hard rectangle.
 *
 * The vertical pass fades over a tighter band than the horizontal one because
 * map cards are wider than they are tall.
 */
export function MapVignette({ color }: { color: string }) {
  const colors = [color, withAlpha(color, 0.1), withAlpha(color, 0.1), color] as const;
  return (
    <>
      <LinearGradient
        colors={colors}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={colors}
        locations={[0, 0.25, 0.75, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
}
