import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats, type TransactionCase } from '../transactionCases';
import type { Variant } from '../types';

/** A conversation: money received sits on the left, money sent on the right. */
function Row({ item }: { item: TransactionCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const incoming = item.direction === 'in';
  const dead = item.state === 'failed' || item.state === 'cancelled';
  const open = item.state !== 'done';
  const status =
    item.state === 'pending'
      ? incoming
        ? 'Confirming'
        : 'Not claimed yet'
      : item.state === 'failed'
        ? 'Not delivered'
        : item.state === 'cancelled'
          ? 'Taken back'
          : null;
  return (
    <View style={{ alignItems: incoming ? 'flex-start' : 'flex-end', gap: 3, paddingVertical: 6 }}>
      <View
        style={{
          backgroundColor: open
            ? paint.canvas
            : incoming
              ? withAlpha(success, 0.16)
              : paint.chipFill,
          borderBottomLeftRadius: incoming ? 4 : 18,
          borderBottomRightRadius: incoming ? 18 : 4,
          borderColor: item.state === 'failed' ? withAlpha(danger, 0.6) : paint.divider,
          borderStyle: item.state === 'pending' ? 'dashed' : 'solid',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderWidth: open ? 1 : 0,
          gap: 1,
          maxWidth: '78%',
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}>
        {item.who ? (
          <Text size={12} semibold numberOfLines={1} color={paint.text.secondary}>
            {item.who}
          </Text>
        ) : null}
        <Text
          size={20}
          bold
          family="mona"
          color={dead ? paint.text.tertiary : paint.text.primary}
          style={dead ? { textDecorationLine: 'line-through' } : undefined}>
          ₿{formatSats(item.sats)}
        </Text>
        {item.memo ? (
          <Text size={14} numberOfLines={2} color={paint.text.primary}>
            {item.memo}
          </Text>
        ) : null}
      </View>
      <Text
        size={11}
        numberOfLines={1}
        color={paint.text.tertiary}
        style={{ paddingHorizontal: 6 }}>
        {status ? (
          <Text size={11} semibold color={item.state === 'failed' ? danger : paint.text.secondary}>
            {status}
            {' · '}
          </Text>
        ) : null}
        {[item.fiat, item.rail, item.locked ? 'locked' : null, item.ago]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

export const T05: Variant<TransactionCase> = {
  id: 'T05',
  name: 'Bubbles',
  idea: 'Direction is position: received payments are bubbles on the left, sent ones on the right, and unsettled ones are outlines.',
  render: (item) => <Row item={item} />,
};
