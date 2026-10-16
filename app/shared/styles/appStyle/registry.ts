/**
 * @fileoverview The app's look, as data.
 *
 * There is one: Glass. It is written as an `AppStyle` so that every spacing,
 * size, radius and surface decision the screens share has a single home, and
 * a decision made in the Design System (a transaction row, a timeline) is
 * adopted by changing a value here or the one component that reads it.
 */

import type { AppStyle } from './types';

export const GLASS: AppStyle = {
  // 4pt grid: related < item < group < section, and group >= pad. The gutter is
  // the navigator's own header inset, so content lines up with the header
  // controls above it.
  space: { gutter: 16, related: 4, item: 12, group: 24, section: 32, pad: 16 },
  size: { control: 48, cta: 56, row: 68 },
  // A pill for a button and a circle for a row's icon seat.
  radius: { card: 28, control: 999, chip: 999 },
  surface: 'glass',
  type: { family: 'oxygen', balance: 44, uppercaseLabels: false },
};
