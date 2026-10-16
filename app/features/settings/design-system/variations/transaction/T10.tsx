import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** A fiat column aligned on the decimal point, so magnitudes compare down the list. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const point = item.fiat.lastIndexOf('.');
  const whole = point === -1 ? item.fiat : item.fiat.slice(0, point);
  const cents = point === -1 ? '' : item.fiat.slice(point);
  const color = dead ? paint.text.tertiary : item.direction === 'in' ? success : paint.text.primary;
  const strike = dead ? ({ textDecorationLine: 'line-through' } as const) : null;
  return (
    <View
      style={{
        alignItems: 'center',
        borderBottomColor: paint.divider,
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: 10,
        paddingVertical: 12,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          size={15}
          medium
          family="mona"
          numberOfLines={1}
          color={dead ? paint.text.tertiary : paint.text.primary}>
          {item.who ?? (item.direction === 'in' ? 'Received' : 'Sent')}
        </Text>
        <Text size={12} numberOfLines={1} color={paint.text.secondary}>
          {item.state === 'done' ? null : (
            <Text size={12} semibold color={item.state === 'failed' ? danger : paint.text.primary}>
              {item.state}
              {' · '}
            </Text>
          )}
          {[`${formatSats(item.sats)} sats`, item.locked ? 'locked' : null, item.time]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View style={{ alignItems: 'baseline', flexDirection: 'row' }}>
        <Text
          size={17}
          family="mono"
          color={color}
          style={{ minWidth: 76, textAlign: 'right', ...strike }}>
          {item.direction === 'in' ? '+' : '−'}
          {whole}
        </Text>
        <Text size={13} family="mono" color={color} style={{ width: 28, ...strike }}>
          {cents}
        </Text>
      </View>
    </View>
  );
}

export const T10: Variant<TransactionCase> = {
  id: 'T10',
  name: 'Decimal column',
  idea: 'Fiat first, in a fixed monospaced column aligned on the decimal point, so that the size of each payment can be compared by eye.',
  render: (item) => <Row item={item} />,
};
