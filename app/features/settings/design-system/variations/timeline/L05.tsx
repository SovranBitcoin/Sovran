import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** A horizontal stepper: nodes across the width, a label under each. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const reached = item.tone === 'success' ? success : paint.text.primary;
  const current = item.steps.find((step) => step.state === 'active' || step.state === 'failed');
  const last = item.steps[item.steps.length - 1];
  const note = current?.detail ?? last?.detail;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row' }}>
        {item.steps.map((step, index) => {
          const next = item.steps[index + 1];
          const fill = step.state === 'failed' ? danger : reached;
          return (
            <View key={step.title} style={{ alignItems: 'center', flex: 1, gap: 6 }}>
              <View style={{ alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row' }}>
                <View
                  style={{
                    backgroundColor: step.state === 'todo' ? paint.divider : reached,
                    flex: 1,
                    height: 2,
                    opacity: index === 0 ? 0 : 1,
                  }}
                />
                <View
                  style={{
                    alignItems: 'center',
                    backgroundColor:
                      step.state === 'done' || step.state === 'failed' ? fill : paint.canvas,
                    borderColor: step.state === 'todo' ? paint.divider : fill,
                    borderRadius: 11,
                    borderWidth: 2,
                    height: 22,
                    justifyContent: 'center',
                    width: 22,
                  }}>
                  {step.state === 'done' || step.state === 'failed' ? (
                    <Icon
                      name={step.state === 'done' ? 'mdi:check' : 'mdi:close'}
                      size={14}
                      color={paint.canvas}
                    />
                  ) : step.state === 'active' ? (
                    <View style={{ backgroundColor: fill, borderRadius: 4, height: 8, width: 8 }} />
                  ) : null}
                </View>
                <View
                  style={{
                    backgroundColor: next && next.state !== 'todo' ? reached : paint.divider,
                    flex: 1,
                    height: 2,
                    opacity: next ? 1 : 0,
                  }}
                />
              </View>
              <Text
                size={11}
                semibold={step.state === 'active' || step.state === 'failed'}
                numberOfLines={3}
                color={
                  step.state === 'failed'
                    ? danger
                    : step.state === 'todo'
                      ? paint.text.tertiary
                      : paint.text.primary
                }
                style={{ paddingHorizontal: 2, textAlign: 'center' }}>
                {step.title}
              </Text>
            </View>
          );
        })}
      </View>
      {note ? (
        <Text size={13} color={paint.text.secondary} style={{ textAlign: 'center' }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export const L05: Variant<TimelineCase> = {
  id: 'L05',
  name: 'Across',
  idea: 'The steps run left to right with a label under each node, so the whole journey is seen in one glance and no times are shown.',
  render: (item) => <Timeline item={item} />,
};
