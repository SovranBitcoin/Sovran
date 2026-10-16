import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** One sentence and a segmented bar: how far along, with no list of steps. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const current = item.steps.find((step) => step.state === 'active' || step.state === 'failed');
  const last = item.steps[item.steps.length - 1];
  const detail = current?.detail ?? last?.detail ?? last?.time ?? '';
  return (
    <View style={{ gap: 10 }}>
      <Text size={22} bold family="mona" color={tone}>
        {item.headline}
      </Text>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {item.steps.map((step) => (
          <View
            key={step.title}
            style={{
              backgroundColor:
                step.state === 'done'
                  ? tone
                  : step.state === 'failed'
                    ? danger
                    : step.state === 'active'
                      ? paint.text.secondary
                      : paint.divider,
              borderRadius: 3,
              flex: 1,
              height: 6,
            }}
          />
        ))}
      </View>
      {detail ? (
        <Text size={14} color={paint.text.secondary}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export const L01: Variant<TimelineCase> = {
  id: 'L01',
  name: 'Verdict and bar',
  idea: 'No step list. One verdict, one segmented bar, one line about the step that matters now.',
  render: (item) => <Timeline item={item} />,
};
