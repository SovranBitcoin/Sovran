import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

function sentence(item: TransactionCase): string {
  if (item.state === 'failed')
    return item.who ? `You couldn't pay ${item.who}` : `You couldn't send`;
  if (item.state === 'cancelled') return 'You took back';
  if (item.direction === 'in') {
    if (item.state === 'pending')
      return item.who ? `${item.who} is paying you` : `You're receiving`;
    return item.who ? `${item.who} paid you` : 'You received';
  }
  if (item.state === 'pending') return item.who ? `You're paying ${item.who}` : `You're sending`;
  return item.who ? `You paid ${item.who}` : 'You sent';
}

const RAIL_WORD = { ecash: 'ecash', lightning: 'Lightning', onchain: 'on-chain' } as const;

/** A plain-language sentence with the fiat amount as its last word. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const aside =
    item.state === 'pending'
      ? item.rail === 'onchain'
        ? 'Confirming'
        : 'Not claimed yet'
      : item.state === 'failed'
        ? 'Nothing left your wallet'
        : item.state === 'cancelled'
          ? 'Returned to you'
          : item.locked
            ? 'Locked to their key'
            : null;
  return (
    <View style={{ gap: 3, paddingVertical: 12 }}>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: 5 }}>
        <Text
          size={17}
          family="mona"
          numberOfLines={1}
          color={dead ? paint.text.secondary : paint.text.primary}
          style={{ flexShrink: 1 }}>
          {sentence(item)}
        </Text>
        <Text
          size={17}
          bold
          family="mona"
          color={
            item.state === 'failed'
              ? danger
              : dead
                ? paint.text.secondary
                : item.direction === 'in'
                  ? success
                  : paint.text.primary
          }>
          {item.fiat}
        </Text>
      </View>
      <Text size={13} numberOfLines={1} color={paint.text.secondary}>
        {[
          aside,
          item.memo ? `“${item.memo}”` : null,
          `${formatSats(item.sats)} sats`,
          RAIL_WORD[item.rail],
          item.ago,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

export const T04: Variant<TransactionCase> = {
  id: 'T04',
  name: 'Sentence',
  idea: 'Each payment is a sentence a person would say, ending in the fiat amount, with sats demoted to the small print.',
  render: (item) => <Row item={item} />,
};
