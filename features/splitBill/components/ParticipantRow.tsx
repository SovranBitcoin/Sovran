/**
 * @fileoverview Memoized row for the split-bill participant picker.
 *
 * Two concrete performance wins over rendering `<ContactRow>` inline from
 * the picker screens:
 *
 *   1. `React.memo` with shallow prop compare — a selection toggle only
 *      flips `selected` on the one row that changed, so every other row
 *      skips render. The picker's list is a plain ScrollView (not a
 *      virtualized list) so every parent re-render would otherwise walk
 *      every row through `ContactRow`'s full derivation pipeline
 *      (`buildStats`, `deriveName`, `candidateToIdentity`, theme lookups).
 *
 *   2. `candidateToIdentity` lifted into a `useMemo` keyed on `candidate`.
 *      When the hook below stabilizes candidate references per
 *      (pubkey, profile), same-input renders produce the same identity
 *      object — ContactRow's own props compare cleanly and the inner
 *      tree doesn't reconcile.
 *
 * The callback stays stable by having the row call `onToggle(candidate)`
 * instead of wrapping it in an inline arrow at the call site. Both picker
 * routes (`participants.tsx`, `search.tsx`) pass the same hook-stable
 * `toggle` fn and get memo hits on every row except the toggled one.
 */

import React, { useCallback, useMemo } from 'react';

import { ContactRow } from '@/shared/ui/composed/ContactRow';
import { candidateToIdentity } from '@/features/splitBill/lib/candidateToIdentity';
import type { PickerCandidate } from '@/features/splitBill/hooks/useSplitBillParticipantPicker';

interface ParticipantRowProps {
  candidate: PickerCandidate;
  selected: boolean;
  /** Stable toggle handler. Row wraps the call with its own candidate to
   *  keep the prop identity stable across renders. */
  onToggle: (candidate: PickerCandidate) => void;
}

export const ParticipantRow = React.memo(function ParticipantRow({
  candidate,
  selected,
  onToggle,
}: ParticipantRowProps) {
  const identity = useMemo(() => candidateToIdentity(candidate), [candidate]);
  const handleToggle = useCallback(() => onToggle(candidate), [candidate, onToggle]);

  return (
    <ContactRow
      identity={identity}
      subtitle={candidate.subtitle}
      selectable
      selected={selected}
      onToggle={handleToggle}
      testID={`contact-row:${candidate.source}:${candidate.id}`}
    />
  );
});
