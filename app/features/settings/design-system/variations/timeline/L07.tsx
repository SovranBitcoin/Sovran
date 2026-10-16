import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** A transcript: each thing that has happened is a timestamped message; the future is one faint line. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [danger] = useThemeColor(['danger'] as const);
  const said = item.steps.filter((step) => step.state !== 'todo');
  const next = item.steps.find((step) => step.state === 'todo');
  return (
    <View style={{ gap: 10 }}>
      {said.map((step) => (
        <View key={step.title} style={{ alignItems: 'flex-start', gap: 3 }}>
          <Text size={11} color={paint.text.tertiary}>
            {step.time ?? 'Now'}
          </Text>
          <View
            style={{
              backgroundColor: paint.chipFill,
              borderColor: step.state === 'failed' ? danger : paint.chipFill,
              borderRadius: 14,
              borderTopLeftRadius: 4,
              borderWidth: 1,
              gap: 2,
              maxWidth: '90%',
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}>
            <Text size={15} semibold color={step.state === 'failed' ? danger : paint.text.primary}>
              {step.title}
            </Text>
            {step.detail ? (
              <Text size={14} color={paint.text.secondary}>
                {step.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {next ? (
        <Text size={13} color={paint.text.tertiary}>
          {`Waiting for: ${next.title}`}
        </Text>
      ) : null}
    </View>
  );
}

export const L07: Variant<TimelineCase> = {
  id: 'L07',
  name: 'Transcript',
  idea: 'The payment tells its story as timestamped messages; steps that have not happened are not drawn at all.',
  render: (item) => <Timeline item={item} />,
};
