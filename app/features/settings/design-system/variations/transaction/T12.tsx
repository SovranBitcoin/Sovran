import type { ReactNode } from 'react';
import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

const RAIL = {
  ecash: { icon: 'majesticons:coins', label: 'Ecash' },
  lightning: { icon: 'mdi:lightning-bolt', label: 'Lightning' },
  onchain: { icon: 'hugeicons:blockchain-01', label: 'On-chain' },
} as const;

function Chip({ fill, children }: { fill: string; children: ReactNode }) {
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: fill,
        borderRadius: 999,
        flexDirection: 'row',
        flexShrink: 1,
        gap: 4,
        paddingHorizontal: 9,
        paddingVertical: 4,
      }}>
      {children}
    </View>
  );
}

/** Every fact about the payment is a tag; only the amount is left as plain text. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const incoming = item.direction === 'in';
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const rail = RAIL[item.rail];
  const stateTone =
    item.state === 'failed' ? danger : item.state === 'pending' ? warning : paint.text.secondary;
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: 8 }}>
        <Text
          size={19}
          bold
          family="mona"
          color={dead ? paint.text.tertiary : paint.text.primary}
          style={dead ? { textDecorationLine: 'line-through' } : undefined}>
          {formatSats(item.sats)}
        </Text>
        <Text size={13} numberOfLines={1} color={paint.text.secondary} style={{ flex: 1 }}>
          sats · {item.fiat}
        </Text>
        <Text size={12} color={paint.text.tertiary}>
          {item.ago}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip fill={incoming ? withAlpha(success, 0.16) : paint.chipFill}>
          <Icon
            name={incoming ? 'mdi:arrow-down' : 'mdi:arrow-up'}
            size={13}
            color={incoming ? success : paint.text.primary}
          />
          <Text size={12} semibold color={incoming ? success : paint.text.primary}>
            {incoming ? 'In' : 'Out'}
          </Text>
        </Chip>
        {item.state === 'done' ? null : (
          <Chip fill={withAlpha(stateTone, 0.16)}>
            <Text size={12} semibold color={stateTone}>
              {item.state === 'failed'
                ? 'Failed'
                : item.state === 'cancelled'
                  ? 'Cancelled'
                  : 'Pending'}
            </Text>
          </Chip>
        )}
        {item.who ? (
          <Chip fill={paint.chipFill}>
            <Text size={12} semibold numberOfLines={1} color={paint.text.primary}>
              {item.who}
            </Text>
          </Chip>
        ) : null}
        <Chip fill={paint.chipFill}>
          <Icon name={rail.icon} size={13} color={paint.text.secondary} />
          <Text size={12} color={paint.text.secondary}>
            {rail.label}
          </Text>
        </Chip>
        {item.locked ? (
          <Chip fill={paint.chipFill}>
            <Icon name="mdi:lock-outline" size={13} color={paint.text.secondary} />
            <Text size={12} color={paint.text.secondary}>
              Locked
            </Text>
          </Chip>
        ) : null}
        {item.memo ? (
          <Chip fill={paint.chipFill}>
            <Text size={12} numberOfLines={1} color={paint.text.secondary}>
              “{item.memo}”
            </Text>
          </Chip>
        ) : null}
      </View>
    </View>
  );
}

export const T12: Variant<TransactionCase> = {
  id: 'T12',
  name: 'Tags',
  idea: 'Every fact is a tag in a wrapping strip, so each row carries only the tags that apply and the filter vocabulary is visible in the list.',
  render: (item) => <Row item={item} />,
};
