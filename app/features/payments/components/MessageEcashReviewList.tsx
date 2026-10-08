import { getMintDisplayName } from '@/shared/lib/url';
import { useStylePaint } from '@/shared/styles/appStyle';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface, useSurfaceInset } from '@/shared/ui/composed/Surface';

import type { ParkedMessageEcash } from '../lib/parkedMessageEcash';

/**
 * Reason first, mint second: the row truncates from the end, and the reason
 * is what tells the person why this needs them.
 */
function subtitleFor(entry: ParkedMessageEcash): string {
  const mint = getMintDisplayName(entry.mintUrl);
  return entry.reason === 'untrusted-mint' ? `Unknown mint · ${mint}` : `Not added · ${mint}`;
}

/** The section itself, given its tokens. Renders nothing for an empty list. */
export function MessageEcashReviewList({
  entries,
  onOpen,
}: {
  entries: readonly ParkedMessageEcash[];
  onOpen: (entry: ParkedMessageEcash) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <Surface testID="message-ecash-to-review">
      <SectionHeading label="Needs your review" />
      {entries.map((entry) => (
        <ReviewRow key={entry.tokenHash} entry={entry} onOpen={onOpen} />
      ))}
    </Surface>
  );
}

function ReviewRow({
  entry,
  onOpen,
}: {
  entry: ParkedMessageEcash;
  onOpen: (entry: ParkedMessageEcash) => void;
}) {
  const paint = useStylePaint();
  // Inside the surface, so the row shares the heading's left edge.
  const inset = useSurfaceInset();
  return (
    <ListRow
      paddingHorizontal={inset}
      testID={`message-ecash-review-${entry.tokenHash.slice(0, 8)}`}
      iconCircle={{
        icon: 'mdi:alert-circle-outline',
        color: paint.text.primary,
        backgroundColor: paint.chipFill,
      }}
      title="Ecash from a message"
      subtitle={subtitleFor(entry)}
      trailing={
        <AmountFormatter
          amount={entry.amount}
          unit={entry.unit}
          size={16}
          weight="medium"
          color={paint.text.primary}
        />
      }
      onPress={() => onOpen(entry)}
      accessibilityLabel={`Ecash from a message. ${subtitleFor(entry)}. Review`}
    />
  );
}
