import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** One dense line: an edge marker, a name, one slot for time or state, the amount. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const marker =
    item.state === 'failed'
      ? danger
      : item.state === 'cancelled'
        ? paint.track
        : item.state === 'pending'
          ? warning
          : item.direction === 'in'
            ? success
            : paint.text.primary;
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, height: 36 }}>
      <View
        style={{
          alignSelf: item.direction === 'in' ? 'flex-end' : 'flex-start',
          backgroundColor: marker,
          borderRadius: 2,
          height: 22,
          width: 3,
        }}
      />
      <Text
        size={14}
        medium
        family="mona"
        numberOfLines={1}
        color={dead ? paint.text.tertiary : paint.text.primary}
        style={{ flex: 1 }}>
        {item.who ?? (item.direction === 'in' ? 'Received' : 'Sent')}
        {item.locked ? ' · locked' : ''}
      </Text>
      <Text
        size={12}
        color={
          item.state === 'failed'
            ? danger
            : item.state === 'pending'
              ? warning
              : paint.text.tertiary
        }>
        {item.state === 'done' ? item.ago : item.state}
      </Text>
      <Text
        size={14}
        semibold
        family="mona"
        color={dead ? paint.text.tertiary : item.direction === 'in' ? success : paint.text.primary}
        style={{
          fontVariant: ['tabular-nums'],
          minWidth: 64,
          textAlign: 'right',
          textDecorationLine: dead ? 'line-through' : 'none',
        }}>
        {formatSats(item.sats)}
      </Text>
    </View>
  );
}

export const T06: Variant<TransactionCase> = {
  id: 'T06',
  name: 'Dense line',
  idea: 'Twice as many payments per screen: one 36-point line where a coloured edge mark replaces the icon, the sign and the status badge.',
  render: (item) => <Row item={item} />,
};
