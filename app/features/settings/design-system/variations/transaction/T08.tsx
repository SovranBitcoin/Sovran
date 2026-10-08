import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** Settled payments whisper on one line; anything unsettled becomes a loud block. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [danger, warning] = useThemeColor(['danger', 'warning'] as const);
  const incoming = item.direction === 'in';
  const signed = `${incoming ? '+' : '−'}${formatSats(item.sats)}`;
  const party = item.who ?? (incoming ? 'Received' : 'Sent');
  if (item.state === 'done') {
    return (
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 9 }}>
        <Text size={14} numberOfLines={1} color={paint.text.secondary} style={{ flexShrink: 1 }}>
          {[party, item.memo].filter(Boolean).join(' · ')}
        </Text>
        {item.locked ? (
          <Icon name="mdi:lock-outline" size={13} color={paint.text.tertiary} />
        ) : null}
        <View style={{ flex: 1 }} />
        <Text size={14} medium color={paint.text.secondary}>
          {signed}
        </Text>
      </View>
    );
  }
  const tone =
    item.state === 'failed' ? danger : item.state === 'pending' ? warning : paint.text.secondary;
  const headline =
    item.state === 'failed'
      ? 'Failed'
      : item.state === 'cancelled'
        ? 'Cancelled'
        : incoming
          ? 'Confirming'
          : 'Waiting to be claimed';
  const icon =
    item.state === 'failed'
      ? 'mdi:alert-circle-outline'
      : item.state === 'cancelled'
        ? 'mdi:cancel'
        : 'mdi:clock-outline';
  return (
    <View
      style={{
        backgroundColor: item.state === 'cancelled' ? paint.chipFill : withAlpha(tone, 0.14),
        borderRadius: 14,
        gap: 4,
        marginVertical: 6,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
        <Icon name={icon} size={20} color={tone} />
        <Text size={18} bold family="mona" numberOfLines={1} color={tone} style={{ flex: 1 }}>
          {headline}
        </Text>
        <Text size={18} bold family="mona" color={paint.text.primary}>
          {signed}
        </Text>
      </View>
      <Text size={13} numberOfLines={1} color={paint.text.secondary}>
        {[
          item.who ? `${incoming ? 'From' : 'To'} ${item.who}` : null,
          item.rail,
          item.fiat,
          item.ago,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

export const T08: Variant<TransactionCase> = {
  id: 'T08',
  name: 'Exceptions shout',
  idea: 'Finished payments shrink to a grey line so that the few pending, failed or cancelled ones are the only loud things in the list.',
  render: (item) => <Row item={item} />,
};
