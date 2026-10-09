import { getMintDisplayName } from '@/shared/lib/url';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface } from '@/shared/ui/composed/Surface';

import type { ParkedMintGroup } from '../lib/parkedMessageEcash';

import { MessageEcashRow } from './MessageEcashRow';

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
      {groups.map((group) => {
        // The mint and nothing else: the title says what the row does, and the
        // amount says how much is behind it.
        const mint = getMintDisplayName(group.mintUrl);
        return (
          <MessageEcashRow
            key={group.key}
            testID={`message-ecash-mint-${group.key.replace(/[^a-z0-9]+/gi, '-')}`}
            mintUrl={group.mintUrl}
            showPicture={!group.unknownMint}
            amount={group.total}
            unit={group.unit}
            title="Receive all"
            detail={mint}
            accessibilityLabel={`Receive all from ${mint}`}
            onPress={() => onOpen(group)}
          />
        );
      })}
    </Surface>
  );
}
