import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

const PERFORATIONS = Array.from({ length: 28 }, (_, index) => index);

/** A boarding pass: origin and destination on top, a perforation, the status on the stub. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const first = item.steps[0];
  const last = item.steps[item.steps.length - 1];
  const current = item.steps.find((step) => step.state === 'active' || step.state === 'failed');
  const times = item.steps.flatMap((step) => (step.time ? [step.time] : []));
  const note = current?.detail ?? last?.detail;
  const stops = item.steps.length - 2;
  return (
    <View style={{ backgroundColor: paint.chipFill, borderRadius: 16 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, padding: 14 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text size={10} semibold color={paint.text.tertiary}>
            FROM
          </Text>
          <Text size={15} semibold numberOfLines={2} color={paint.text.primary}>
            {first?.title ?? ''}
          </Text>
        </View>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Icon name="mdi:arrow-right" size={18} color={paint.text.secondary} />
          <Text size={10} color={paint.text.tertiary}>
            {stops > 0 ? `${stops} between` : 'direct'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', flex: 1, gap: 2 }}>
          <Text size={10} semibold color={paint.text.tertiary}>
            TO
          </Text>
          <Text
            size={15}
            semibold
            numberOfLines={2}
            color={last?.state === 'todo' ? paint.text.secondary : paint.text.primary}
            style={{ textAlign: 'right' }}>
            {last?.title ?? ''}
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          overflow: 'hidden',
          paddingHorizontal: 6,
        }}>
        {PERFORATIONS.map((index) => (
          <View
            key={index}
            style={{
              backgroundColor: paint.text.tertiary,
              borderRadius: 1,
              height: 2,
              opacity: 0.5,
              width: 5,
            }}
          />
        ))}
      </View>
      <View style={{ gap: 8, padding: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={10} semibold color={paint.text.tertiary}>
              STATUS
            </Text>
            <Text size={17} bold family="mona" color={tone}>
              {item.headline}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text size={10} semibold color={paint.text.tertiary}>
              LAST UPDATE
            </Text>
            <Text size={13} medium color={paint.text.secondary}>
              {times[times.length - 1] ?? 'None yet'}
            </Text>
          </View>
        </View>
        {note ? (
          <Text size={13} color={paint.text.secondary}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const L12: Variant<TimelineCase> = {
  id: 'L12',
  name: 'Ticket',
  idea: 'A boarding-pass stub: only where the payment starts and where it is going, then a tear line and its status.',
  render: (item) => <Timeline item={item} />,
};
