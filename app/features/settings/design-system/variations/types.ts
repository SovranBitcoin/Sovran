/**
 * @fileoverview Design System · Variations.
 *
 * A subject is one component being redesigned: a transaction row, a payment
 * timeline. It has CASES (the states the component must handle, as plain
 * data) and VARIANTS (independent drawings of it). The Variations screen
 * shows one variant at a time, on every case at once, with a tab per variant.
 *
 * A variant is exploration, not product code. It draws from the case data
 * alone and shares nothing with the other variants or with the component the
 * app ships, so that a variant can be judged, picked or thrown away on its
 * own. Once a person picks one, it is rebuilt into the real component and the
 * subject's variants are deleted.
 */
import type { ReactElement } from 'react';

export interface Variant<Case> {
  /** Stable short code, said aloud when choosing: "T07". */
  readonly id: string;
  readonly name: string;
  /** One sentence: the idea this variant tests. */
  readonly idea: string;
  render(item: Case): ReactElement;
}

export interface Subject<Case> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /**
   * `list`: the cases are siblings in a list (rows); they are stacked with no
   * gap, as they would appear. `separate`: each case is its own object and
   * gets its own labelled block.
   */
  readonly arrangement: 'list' | 'separate';
  readonly cases: readonly { readonly label: string; readonly item: Case }[];
  readonly variants: readonly Variant<Case>[];
}
