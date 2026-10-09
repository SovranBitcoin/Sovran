import { getMintDisplayName } from '@/shared/lib/url';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface } from '@/shared/ui/composed/Surface';

import type { ParkedMintGroup } from '../lib/parkedMessageEcash';

import { MessageEcashRow } from './MessageEcashRow';

/** Mint first, then how much is behind the row. An unknown mint says so. */
function detailFor(group: ParkedMintGroup): string {
  const mint = getMintDisplayName(group.mintUrl);
  const count = group.count === 1 ? '1 payment' : `${group.count} payments`;
  return group.unknownMint ? `Unknown mint · ${mint} · ${count}` : `${mint} · ${count}`;
}

/**
 * Message ecash waiting on the person, as a card of payments beside Pending
 * and Confirmed: one row per mint, each standing for everything held there.
 * Renders nothing for an empty list.
 */
export function MessageEcashReviewList({
  groups,
  onOpen,
}: {
  groups: readonly ParkedMintGroup[];
  onOpen: (group: ParkedMintGroup) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <Surface testID="message-ecash-to-review">
      <SectionHeading tone="status" label="To receive" detail="Ecash from messages" />
      {groups.map((group) => (
        <MessageEcashRow
          key={group.key}
          testID={`message-ecash-mint-${group.key.replace(/[^a-z0-9]+/gi, '-')}`}
          mintUrl={group.mintUrl}
          showPicture={!group.unknownMint}
          amount={group.total}
          unit={group.unit}
          title="Receive all"
          detail={detailFor(group)}
          accessibilityLabel={`Receive all. ${detailFor(group)}`}
          onPress={() => onOpen(group)}
        />
      ))}
    </Surface>
  );
}
