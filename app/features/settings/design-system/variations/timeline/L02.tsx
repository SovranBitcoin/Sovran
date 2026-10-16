import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase, TimelineStep } from '../timelineCases';
import type { Variant } from '../types';

const MARK = {
  done: 'mdi:check',
  active: 'fluent:circle-16-filled',
  todo: 'mdi:circle-outline',
  failed: 'mdi:close',
} as const satisfies Record<TimelineStep['state'], string>;

/** A receipt: every step is a line, the time in a fixed right-hand column. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  return (
    <View>
      {item.steps.map((step, index) => {
        const reached = step.state !== 'todo';
        const color =
          step.state === 'failed' ? danger : reached ? paint.text.primary : paint.text.tertiary;
        return (
          <View
            key={step.title}
            style={{
              borderTopColor: paint.divider,
              borderTopWidth: index === 0 ? 0 : 1,
              flexDirection: 'row',
              gap: 10,
              paddingVertical: 12,
            }}>
            <Icon
              name={MARK[step.state]}
              size={18}
              color={step.state === 'done' ? success : color}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text size={16} semibold={step.state === 'active'} color={color}>
                {step.title}
              </Text>
              {step.detail ? (
                <Text size={13} color={paint.text.secondary}>
                  {step.detail}
                </Text>
              ) : null}
            </View>
            <Text size={13} color={paint.text.secondary}>
              {step.time ?? '—'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export const L02: Variant<TimelineCase> = {
  id: 'L02',
  name: 'Receipt',
  idea: 'Every step is a ruled line with its time in a right-hand column, like a till receipt.',
  render: (item) => <Timeline item={item} />,
};
