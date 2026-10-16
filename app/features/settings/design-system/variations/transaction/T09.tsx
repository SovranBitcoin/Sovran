import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

const RAIL = {
  ecash: { icon: 'majesticons:coins', label: 'ECASH' },
  lightning: { icon: 'mdi:lightning-bolt', label: 'LIGHTNING' },
  onchain: { icon: 'hugeicons:blockchain-01', label: 'ON-CHAIN' },
} as const;

/** The rail is the organising element: a labelled tile leads every row. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const rail = RAIL[item.rail];
  const end =
    item.state === 'failed'
      ? ({ icon: 'mdi:alert-circle-outline', color: danger } as const)
      : item.state === 'cancelled'
        ? ({ icon: 'mdi:cancel', color: paint.text.tertiary } as const)
        : item.state === 'pending'
          ? ({ icon: 'mdi:clock-outline', color: warning } as const)
          : item.locked
            ? ({ icon: 'mdi:lock-outline', color: paint.text.secondary } as const)
            : ({ icon: 'mdi:check', color: paint.text.tertiary } as const);
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 8 }}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: paint.chipFill,
          borderRadius: 10,
          gap: 3,
          paddingVertical: 8,
          width: 68,
        }}>
        <Icon name={rail.icon} size={18} color={dead ? paint.text.tertiary : paint.text.primary} />
        <Text size={9} bold color={paint.text.secondary} style={{ letterSpacing: 0.6 }}>
          {rail.label}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          size={17}
          semibold
          family="mona"
          color={
            dead ? paint.text.tertiary : item.direction === 'in' ? success : paint.text.primary
          }
          style={dead ? { textDecorationLine: 'line-through' } : undefined}>
          {item.direction === 'in' ? '+' : '−'}
          {formatSats(item.sats)}
        </Text>
        <Text size={13} numberOfLines={1} color={paint.text.secondary}>
          {[item.who, item.memo, item.state === 'done' ? null : item.state, item.time]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Icon name={end.icon} size={18} color={end.color} />
    </View>
  );
}

export const T09: Variant<TransactionCase> = {
  id: 'T09',
  name: 'Rail tile',
  idea: 'How the money moved comes first: a labelled ecash, Lightning or on-chain tile leads, and a single end icon reports the outcome.',
  render: (item) => <Row item={item} />,
};
