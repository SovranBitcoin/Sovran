import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** A ledger: the time is the left column and the entry reads across from it. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const note =
    item.state === 'failed'
      ? 'Failed'
      : item.state === 'cancelled'
        ? 'Cancelled'
        : item.state === 'pending'
          ? 'Pending'
          : null;
  const noteColor =
    item.state === 'failed' ? danger : item.state === 'pending' ? warning : paint.text.secondary;
  const rest = [item.memo, item.locked ? 'locked' : null].filter(Boolean).join(' · ');
  return (
    <View
      style={{
        alignItems: 'baseline',
        borderBottomColor: paint.divider,
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: 10,
        paddingVertical: 10,
      }}>
      <Text
        size={12}
        family="mono"
        numberOfLines={1}
        color={paint.text.tertiary}
        style={{ width: 70 }}>
        {item.time}
      </Text>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          size={15}
          medium
          family="mona"
          numberOfLines={1}
          color={dead ? paint.text.tertiary : paint.text.primary}>
          {item.who ?? (item.direction === 'in' ? 'Received' : 'Sent')}
        </Text>
        {note || rest ? (
          <Text size={12} numberOfLines={1} color={paint.text.secondary}>
            {note ? (
              <Text size={12} semibold color={noteColor}>
                {note}
              </Text>
            ) : null}
            {note && rest ? ' · ' : ''}
            {rest}
          </Text>
        ) : null}
      </View>
      <Text
        size={15}
        family="mono"
        color={dead ? paint.text.tertiary : item.direction === 'in' ? success : paint.text.primary}
        style={dead ? { textDecorationLine: 'line-through' } : undefined}>
        {item.direction === 'in' ? '+' : '−'}
        {formatSats(item.sats)}
      </Text>
    </View>
  );
}

export const T03: Variant<TransactionCase> = {
  id: 'T03',
  name: 'Ledger',
  idea: 'Time is the left column, so the list reads as a dated ledger and a second line appears only when there is something to add.',
  render: (item) => <Row item={item} />,
};
