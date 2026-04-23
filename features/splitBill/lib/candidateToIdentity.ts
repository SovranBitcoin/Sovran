/**
 * @fileoverview Adapter from the split-bill picker's `PickerCandidate`
 * shape to the shared `ContactRow` `Identity`. Both call sites (main
 * participants screen and search modal) share the mapping.
 *
 * Each candidate maps to a single-kind identity — rows are never mint+nostr
 * composites here. The candidate's `subtitle` is carried through as the
 * row's `subtitle` prop so it wins over ContactRow's default derivation.
 */

import {
  bleIdentity,
  nostrIdentity,
  selfIdentity,
  type Identity,
} from '@/shared/ui/composed/ContactRow';
import type { PickerCandidate } from '../hooks/useSplitBillParticipantPicker';

export function candidateToIdentity(c: PickerCandidate): Identity {
  switch (c.source) {
    case 'self':
      return selfIdentity(c.pubkey ?? '', c.nickname ?? '', {
        avatarUrl: c.avatarUrl,
        isActive: !!c.isActive,
        subtitle: c.subtitle,
      });
    case 'ble':
      // Leave isConnected undefined so ContactRow's default subtitle path
      // doesn't run — the caller's `subtitle` prop encodes connection state.
      return bleIdentity({ peerID: c.peerID ?? '', nickname: c.nickname });
    case 'nostr':
    case 'search': {
      // Build a profile only when we have *something* to render beyond the
      // pubkey stub — avoids flashing a zero-data row with an empty
      // NIP-05 pill. Fields flow through verbatim: nickname/avatar from
      // kind-0, nip05 from kind-0 (the hook plumbs `c.nip05`), stats from
      // the session-scoped search-hit cache.
      const hasAnyProfile = !!(c.nickname || c.avatarUrl || c.nip05 || c.score !== undefined);
      const profile = hasAnyProfile
        ? {
            display_name: c.nickname,
            picture: c.avatarUrl,
            nip05: c.nip05,
            nip05Valid: c.nip05Valid,
            score: c.score,
            followers: c.followerCount,
            follows: c.followingCount,
          }
        : undefined;
      return nostrIdentity(c.pubkey ?? '', profile, { isLoadingProfile: c.isLoadingProfile });
    }
  }
}
