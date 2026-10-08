import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

const RAIL_WORD = { ecash: 'Ecash', lightning: 'Lightning', onchain: 'On-chain' } as const;

/** A tall receipt card per payment, with every fact on its own labelled line. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const incoming = item.direction === 'in';
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const heading =
    item.state === 'failed'
      ? 'Payment failed'
      : item.state === 'cancelled'
        ? 'Payment cancelled'
        : incoming
          ? item.state === 'pending'
            ? 'Receiving'
            : 'Received'
          : item.state === 'pending'
            ? 'Sending'
            : 'Sent';
  const headingColor =
    item.state === 'failed'
      ? danger
      : item.state === 'pending'
        ? warning
        : item.state === 'done' && incoming
          ? success
          : paint.text.secondary;
  const lines = [
    item.who ? ([incoming ? 'From' : 'To', item.who] as const) : null,
    [
      'Via',
      item.locked ? `${RAIL_WORD[item.rail]}, locked to a key` : RAIL_WORD[item.rail],
    ] as const,
    item.memo ? (['Note', item.memo] as const) : null,
    ['Worth', item.fiat] as const,
  ].filter((line) => line !== null);
  return (
    <View
      style={{
        backgroundColor: paint.chipFill,
        borderRadius: 18,
        gap: 10,
        marginVertical: 6,
        padding: 16,
      }}>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: 8 }}>
        <Text
          size={13}
          bold
          numberOfLines={1}
          color={headingColor}
          style={{ flex: 1, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {heading}
        </Text>
        <Text size={12} color={paint.text.tertiary}>
          {item.time}
        </Text>
      </View>
      <Text
        size={30}
        bold
        family="mona"
        color={dead ? paint.text.tertiary : paint.text.primary}
        style={dead ? { textDecorationLine: 'line-through' } : undefined}>
        ₿{formatSats(item.sats)}
      </Text>
      <View style={{ borderTopColor: paint.divider, borderTopWidth: 1, gap: 4, paddingTop: 10 }}>
        {lines.map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', gap: 8 }}>
            <Text size={13} color={paint.text.tertiary} style={{ width: 48 }}>
              {label}
            </Text>
            <Text size={13} medium numberOfLines={1} color={paint.text.primary} style={{ flex: 1 }}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export const T13: Variant<TransactionCase> = {
  id: 'T13',
  name: 'Receipt card',
  idea: 'Each payment is a tall card that already says everything, testing whether a list of receipts removes the need to open a detail page.',
  render: (item) => <Row item={item} />,
};
