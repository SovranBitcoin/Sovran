import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

const RAIL_ICON = {
  ecash: 'majesticons:coins',
  lightning: 'mdi:lightning-bolt',
  onchain: 'hugeicons:blockchain-01',
} as const;

/** The amount leads, large and left; everything else is one quiet line under it. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const color = dead ? paint.text.tertiary : item.direction === 'in' ? success : paint.text.primary;
  const status =
    item.state === 'pending'
      ? 'In progress'
      : item.state === 'failed'
        ? 'Failed'
        : item.state === 'cancelled'
          ? 'Cancelled'
          : null;
  return (
    <View style={{ gap: 4, paddingVertical: 14 }}>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: 8 }}>
        <Text size={26} bold family="mona" color={color}>
          {item.direction === 'in' ? '+' : '−'}
          {formatSats(item.sats)}
        </Text>
        <Text size={14} color={paint.text.secondary}>
          {item.fiat}
        </Text>
        <View style={{ flex: 1 }} />
        {status ? (
          <Text size={13} semibold color={item.state === 'failed' ? danger : paint.text.secondary}>
            {status}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
        <Icon name={RAIL_ICON[item.rail]} size={14} color={paint.text.secondary} />
        <Text size={14} numberOfLines={1} color={paint.text.secondary} style={{ flex: 1 }}>
          {[item.who ?? (item.direction === 'in' ? 'Received' : 'Sent'), item.memo, item.time]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {item.locked ? (
          <Icon name="mdi:lock-outline" size={14} color={paint.text.secondary} />
        ) : null}
      </View>
    </View>
  );
}

export const T02: Variant<TransactionCase> = {
  id: 'T02',
  name: 'Amount first',
  idea: 'The number is the row. It leads at display size; who, how and when are one line beneath.',
  render: (item) => <Row item={item} />,
};
