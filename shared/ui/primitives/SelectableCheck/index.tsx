import { memo } from 'react';

import { SelectableCheckCircle } from './SelectableCheck.circle';
import { SelectableCheckSquare } from './SelectableCheck.square';
import type { SelectableCheckProps } from './types';

/**
 * Selection mark for "is this option selected?" UI. Two styles:
 *
 *  - `circle` (default) — filled brand-accent circle with a white check.
 *    Used by in-app pickers like the split-bill participant list.
 *  - `square` — native-feeling square checkbox with palette variants.
 *    Used by onboarding terms, settings toggles, and any surface that
 *    expects a familiar platform checkbox affordance.
 *
 * Dispatch is a plain inline switch (NOT `defineVariants`) — the axis is a
 * design choice, not a device capability, so the wrapper-with-Log machinery
 * `defineVariants` adds is pure overhead. This component sits inside list
 * rows that re-render on every toggle, so the path stays tight: `React.memo`
 * skips work when props don't change, and the dispatch itself is one
 * branch, no hook call.
 */
export const SelectableCheck = memo(function SelectableCheck(props: SelectableCheckProps) {
  return props.style === 'square' ? (
    <SelectableCheckSquare {...props} />
  ) : (
    <SelectableCheckCircle {...props} />
  );
});
