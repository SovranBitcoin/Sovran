/**
 * Corner rounding shared by every CapsuleButton variant.
 *
 * `.flat`, `.blur` and `.liquid` are separate render strategies but they must
 * agree on geometry — a capsule that rounds differently between platforms is a
 * visible seam when two of them sit in the same segmented row. Radius and the
 * side-selection switch therefore live here, not in each variant.
 */
import { StyleSheet } from 'react-native';

import type { CapsuleButtonProps } from './CapsuleButton.types';

const CORNER_RADIUS = 24;

const cornerStyles = StyleSheet.create({
  allCorners: {
    borderRadius: CORNER_RADIUS,
  },
  leftCorners: {
    borderTopLeftRadius: CORNER_RADIUS,
    borderBottomLeftRadius: CORNER_RADIUS,
  },
  rightCorners: {
    borderTopRightRadius: CORNER_RADIUS,
    borderBottomRightRadius: CORNER_RADIUS,
  },
});

export function getCornerStyle(roundedSide: NonNullable<CapsuleButtonProps['roundedSide']>) {
  switch (roundedSide) {
    case 'left':
      return cornerStyles.leftCorners;
    case 'right':
      return cornerStyles.rightCorners;
    case 'all':
    default:
      return cornerStyles.allCorners;
  }
}
