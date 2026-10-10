import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

const RAIL_NOUN = {
  ecash: 'Ecash payment',
  lightning: 'Lightning payment',
  onchain: 'On-chain payment',
} as const;

/** What the payment was for is the title; who and how much are the footnote. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const incoming = item.direction === 'in';
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const stateColor =
    item.state === 'failed' ? danger : item.state === 'pending' ? warning : paint.text.secondary;
  return (
    <View style={{ gap: 3, paddingVertical: 12 }}>
      <Text
        size={17}
        semibold={Boolean(item.memo)}
        family="mona"
        numberOfLines={2}
        color={item.memo && !dead ? paint.text.primary : paint.text.tertiary}>
        {item.memo ?? RAIL_NOUN[item.rail]}
      </Text>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5 }}>
        <Icon
          name={incoming ? 'lucide:arrow-down-left' : 'lucide:arrow-up-right'}
          size={14}
          color={dead ? paint.text.tertiary : incoming ? success : paint.text.secondary}
        />
        {item.state === 'done' ? null : (
          <Text size={13} semibold color={stateColor}>
            {item.state}
          </Text>
        )}
        <Text size={13} numberOfLines={1} color={paint.text.secondary} style={{ flexShrink: 1 }}>
          {item.who ? `${incoming ? 'from' : 'to'} ${item.who}` : incoming ? 'received' : 'sent'}
        </Text>
        {item.locked ? (
          <Icon name="mdi:lock-outline" size={13} color={paint.text.secondary} />
        ) : null}
        <Text
          size={13}
          medium
          color={dead ? paint.text.tertiary : paint.text.primary}
          style={dead ? { textDecorationLine: 'line-through' } : undefined}>
          ₿{formatSats(item.sats)}
        </Text>
        <View style={{ flex: 1 }} />
        <Text size={12} color={paint.text.tertiary}>
          {item.ago}
        </Text>
      </View>
    </View>
  );
}

export const T11: Variant<TransactionCase> = {
  id: 'T11',
  name: 'Memo led',
  idea: 'The note is the headline and the amount is a footnote, which shows how the list reads when most payments carry no note.',
  render: (item) => <Row item={item} />,
};
