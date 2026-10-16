import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** A pile of cards: the current step is the full card, finished and future steps shrink away from it. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const front = at === -1 ? item.steps.length - 1 : at;
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  return (
    <View style={{ gap: 3 }}>
      {item.steps.map((step, index) => {
        const distance = Math.min(3, Math.abs(index - front));
        if (index === front) {
          return (
            <View
              key={step.title}
              style={{
                backgroundColor: paint.chipFill,
                borderColor: tone,
                borderRadius: 14,
                borderWidth: 1.5,
                gap: 3,
                padding: 14,
              }}>
              <Text size={18} bold family="mona" color={tone}>
                {step.title}
              </Text>
              {step.detail ? (
                <Text size={14} color={paint.text.secondary}>
                  {step.detail}
                </Text>
              ) : null}
              {step.time ? (
                <Text size={12} color={paint.text.tertiary}>
                  {step.time}
                </Text>
              ) : null}
            </View>
          );
        }
        const behind = index < front;
        return (
          <View
            key={step.title}
            style={{
              backgroundColor: behind ? paint.chipFill : paint.canvas,
              borderColor: behind ? paint.chipFill : paint.divider,
              borderRadius: 8,
              borderWidth: 1,
              marginHorizontal: distance * 12,
              opacity: 1 - distance * 0.2,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}>
            <Text
              size={12}
              numberOfLines={1}
              color={behind ? paint.text.secondary : paint.text.tertiary}
              style={{ textAlign: 'center' }}>
              {step.title}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export const L13: Variant<TimelineCase> = {
  id: 'L13',
  name: 'Card pile',
  idea: 'Steps are a pile of cards with the current one in front at full size, and the others narrowing and fading with distance.',
  render: (item) => <Timeline item={item} />,
};
