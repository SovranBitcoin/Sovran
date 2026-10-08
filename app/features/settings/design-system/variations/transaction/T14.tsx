import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

const STEPS = [0, 1, 2] as const;

/** The line under the row is its state: a hairline when settled, a stepped bar when not. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const incoming = item.direction === 'in';
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const reached = item.state === 'pending' ? (item.rail === 'onchain' ? 2 : 1) : 0;
  const caption =
    item.state === 'pending'
      ? item.rail === 'onchain'
        ? 'Seen on-chain, confirming'
        : incoming
          ? 'On its way'
          : 'Sent, waiting to be claimed'
      : item.state === 'failed'
        ? 'Failed, nothing was sent'
        : item.state === 'cancelled'
          ? 'Cancelled, returned to you'
          : null;
  return (
    <View style={{ gap: 8, paddingTop: 12 }}>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: 10 }}>
        <Text
          size={16}
          medium
          family="mona"
          numberOfLines={1}
          color={dead ? paint.text.tertiary : paint.text.primary}
          style={{ flex: 1 }}>
          {item.who ?? (incoming ? 'Received' : 'Sent')}
          {item.locked ? ' · locked' : ''}
        </Text>
        <Text
          size={16}
          semibold
          family="mona"
          color={dead ? paint.text.tertiary : incoming ? success : paint.text.primary}>
          {incoming ? '+' : '−'}
          {formatSats(item.sats)}
        </Text>
      </View>
      {caption ? (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
          <Text
            size={12}
            semibold
            numberOfLines={1}
            color={
              item.state === 'failed'
                ? danger
                : item.state === 'pending'
                  ? warning
                  : paint.text.secondary
            }
            style={{ flex: 1 }}>
            {caption}
          </Text>
          <Text size={12} color={paint.text.tertiary}>
            {item.ago}
          </Text>
        </View>
      ) : null}
      {item.state === 'done' ? (
        <View style={{ backgroundColor: paint.divider, height: 1, marginTop: 4 }} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {STEPS.map((step) => (
            <View
              key={step}
              style={{
                backgroundColor:
                  item.state === 'failed'
                    ? danger
                    : item.state === 'pending' && step < reached
                      ? warning
                      : paint.track,
                borderRadius: 2,
                flex: 1,
                height: 3,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export const T14: Variant<TransactionCase> = {
  id: 'T14',
  name: 'Progress line',
  idea: 'The divider is the status: settled rows end in a hairline and say nothing more, unsettled rows end in a stepped bar with a caption.',
  render: (item) => <Row item={item} />,
};
