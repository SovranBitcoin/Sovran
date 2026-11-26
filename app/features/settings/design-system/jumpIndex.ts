/**
 * @fileoverview A long design-system page's jump index: a pinned pill row
 * whose pills scroll to a section, and which follows the scroll.
 */

/**
 * The section showing at the top of the viewport: the last one whose top has
 * reached the scroll offset. At the end of the scroll the last section wins,
 * since a short last section can never reach the top. `offsets` are section
 * tops in scroll-content order; an id not yet laid out is skipped.
 */
export function activeJumpSection<Id extends string>(
  order: readonly Id[],
  offsets: Partial<Record<Id, number>>,
  scrollY: number,
  atEnd: boolean
): Id | undefined {
  const laidOut = order.filter((id) => offsets[id] !== undefined);
  if (atEnd) return laidOut.at(-1);
  let active = laidOut[0];
  for (const id of laidOut) if ((offsets[id] ?? 0) <= scrollY + 1) active = id;
  return active;
}
