import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** A statement line: no icon at all. The sign and the words carry direction. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const success = useThemeColor('success');
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const verb =
    item.state === 'failed'
      ? 'Failed'
      : item.state === 'cancelled'
        ? 'Cancelled'
        : item.direction === 'in'
          ? item.state === 'pending'
            ? 'Receiving'
            : 'Received'
          : item.state === 'pending'
            ? 'Sending'
            : 'Sent';
  const title = item.who ? `${verb} · ${item.who}` : verb;
  const amountColor = dead
    ? paint.text.tertiary
    : item.direction === 'in'
      ? success
      : paint.text.primary;
  return (
    <View
      style={{
        borderBottomColor: paint.divider,
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 14,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          size={16}
          semibold
          numberOfLines={1}
          color={dead ? paint.text.tertiary : paint.text.primary}>
          {title}
        </Text>
        <Text size={13} numberOfLines={1} color={paint.text.secondary}>
          {[item.rail, item.locked ? 'locked' : null, item.memo, item.ago]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text
          size={16}
          semibold
          color={amountColor}
          style={dead ? { textDecorationLine: 'line-through' } : undefined}>
          {item.direction === 'in' ? '+' : '−'}
          {formatSats(item.sats)}
        </Text>
        <Text size={13} color={paint.text.secondary}>
          {item.fiat}
        </Text>
      </View>
    </View>
  );
}

export const T01: Variant<TransactionCase> = {
  id: 'T01',
  name: 'Statement line',
  idea: 'No icon. A verb, a name, a signed amount, and a hairline: a bank statement.',
  render: (item) => <Row item={item} />,
};
