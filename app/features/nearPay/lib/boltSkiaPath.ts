/**
 * Skia-path projection for bolt geometry.
 *
 * `boltGeometry` stays renderer-agnostic (pure points + PRNG) so it can be
 * unit-tested without a Skia context; this module is the one place that turns
 * a variant into an `SkPath`. Both the strike animation and the Nut Drop
 * celebration canvas draw from here so their stroke geometry cannot drift.
 */
import { Skia } from '@shopify/react-native-skia';

import type { BoltVariant } from './boltGeometry';

export function variantToSkPath(variant: BoltVariant) {
  const path = Skia.Path.Make();
  const [first, ...rest] = variant.main;
  path.moveTo(first.x, first.y);
  for (const point of rest) path.lineTo(point.x, point.y);
  const [forkStart, ...forkRest] = variant.fork;
  path.moveTo(forkStart.x, forkStart.y);
  for (const point of forkRest) path.lineTo(point.x, point.y);
  return path;
}
