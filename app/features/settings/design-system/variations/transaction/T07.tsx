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

/** An inbox: the person is the row, and the payment is the message preview under their name. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const incoming = item.direction === 'in';
  const amount = `${formatSats(item.sats)} sats`;
  const preview =
    item.state === 'failed'
      ? `Failed to send ${amount}`
      : item.state === 'cancelled'
        ? `Cancelled, ${amount} returned`
        : item.state === 'pending'
          ? `${incoming ? 'Receiving' : 'Sending'} ${amount}…`
          : `${incoming ? 'Sent you' : 'You sent'} ${amount}`;
  const previewColor =
    item.state === 'failed'
      ? danger
      : item.state === 'done' && incoming
        ? success
        : item.state === 'cancelled'
          ? paint.text.tertiary
          : paint.text.primary;
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 10 }}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: paint.chipFill,
          borderRadius: 14,
          height: 46,
          justifyContent: 'center',
          width: 46,
        }}>
        {item.who ? (
          <Text size={20} bold family="mona" color={paint.text.primary}>
            {item.who.slice(0, 1).toUpperCase()}
          </Text>
        ) : (
          <Icon name={RAIL_ICON[item.rail]} size={20} color={paint.text.secondary} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          <Text
            size={16}
            semibold
            family="mona"
            numberOfLines={1}
            color={item.who ? paint.text.primary : paint.text.secondary}
            style={{ flexShrink: 1 }}>
            {item.who ?? (incoming ? 'Unknown sender' : 'No one named')}
          </Text>
          {item.locked ? (
            <Icon name="mdi:lock-outline" size={14} color={paint.text.secondary} />
          ) : null}
          <View style={{ flex: 1 }} />
          <Text size={12} color={paint.text.tertiary}>
            {item.ago}
          </Text>
        </View>
        <Text size={14} numberOfLines={1} color={paint.text.secondary}>
          <Text size={14} medium color={previewColor}>
            {preview}
          </Text>
          {item.memo ? ` · ${item.memo}` : ''}
        </Text>
      </View>
    </View>
  );
}

export const T07: Variant<TransactionCase> = {
  id: 'T07',
  name: 'Inbox',
  idea: 'The person is the anchor: a large initial and a name, with the payment written beneath as a message preview and no amount column.',
  render: (item) => <Row item={item} />,
};
