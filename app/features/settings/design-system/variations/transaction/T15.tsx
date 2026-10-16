import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** Double entry: money in and money out each have their own fixed column. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger, warning] = useThemeColor(['success', 'danger', 'warning'] as const);
  const incoming = item.direction === 'in';
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const amount = (
    <View style={{ alignItems: 'flex-end', gap: 1 }}>
      <Text
        size={14}
        numberOfLines={1}
        adjustsFontSizeToFit
        family="mono"
        color={dead ? paint.text.tertiary : incoming ? success : paint.text.primary}
        style={dead ? { textDecorationLine: 'line-through' } : undefined}>
        {formatSats(item.sats)}
      </Text>
      {item.state === 'done' ? null : (
        <Text
          size={10}
          bold
          color={
            item.state === 'failed'
              ? danger
              : item.state === 'pending'
                ? warning
                : paint.text.tertiary
          }
          style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {item.state}
        </Text>
      )}
    </View>
  );
  const empty = (
    <Text size={14} family="mono" color={paint.track}>
      ·
    </Text>
  );
  return (
    <View
      style={{
        borderBottomColor: paint.divider,
        borderBottomWidth: 1,
        flexDirection: 'row',
        paddingVertical: 10,
      }}>
      <View style={{ flex: 1, gap: 1, paddingRight: 8 }}>
        <Text
          size={14}
          medium
          family="mona"
          numberOfLines={1}
          color={dead ? paint.text.tertiary : paint.text.primary}>
          {item.who ?? (item.rail === 'onchain' ? 'On-chain' : item.rail)}
        </Text>
        <Text size={11} numberOfLines={1} color={paint.text.tertiary}>
          {[item.time, item.locked ? 'locked' : null, item.memo].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View
        style={{
          alignItems: 'flex-end',
          borderLeftColor: paint.divider,
          borderLeftWidth: 1,
          paddingHorizontal: 6,
          width: 96,
        }}>
        {incoming ? amount : empty}
      </View>
      <View
        style={{
          alignItems: 'flex-end',
          borderLeftColor: paint.divider,
          borderLeftWidth: 1,
          paddingLeft: 6,
          width: 96,
        }}>
        {incoming ? empty : amount}
      </View>
    </View>
  );
}

export const T15: Variant<TransactionCase> = {
  id: 'T15',
  name: 'Two columns',
  idea: 'Direction is a column, not a sign or colour: money in and money out each sit in their own ruled column, as in a double-entry book.',
  render: (item) => <Row item={item} />,
};
