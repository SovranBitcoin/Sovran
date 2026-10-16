import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** A ring filled in quarters by how many steps are done, with the count inside. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const total = item.steps.length;
  const done = item.steps.filter((step) => step.state === 'done').length;
  const exact = total === 0 ? 0 : (done / total) * 4;
  const quarters =
    done === total ? 4 : done === 0 ? 0 : Math.min(3, Math.max(1, Math.round(exact)));
  const current = item.steps.find((step) => step.state === 'active' || step.state === 'failed');
  const last = item.steps[item.steps.length - 1];
  const note = current?.detail ?? last?.detail ?? last?.time;
  const arc = (quarter: number) => (quarters >= quarter ? tone : paint.track);
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 16 }}>
      <View style={{ alignItems: 'center', height: 76, justifyContent: 'center', width: 76 }}>
        <View
          style={{
            borderBottomColor: arc(3),
            borderLeftColor: arc(4),
            borderRadius: 38,
            borderRightColor: arc(2),
            borderTopColor: arc(1),
            borderWidth: 7,
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <Text size={20} bold family="mona" color={paint.text.primary}>
          {`${done}/${total}`}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text size={18} bold family="mona" color={tone}>
          {item.headline}
        </Text>
        {current && current.title !== item.headline ? (
          <Text size={14} medium color={paint.text.primary}>
            {current.title}
          </Text>
        ) : null}
        {note ? (
          <Text size={13} color={paint.text.secondary}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const L09: Variant<TimelineCase> = {
  id: 'L09',
  name: 'Ring',
  idea: 'Progress is a ring that fills clockwise with the count of finished steps inside it, beside the verdict.',
  render: (item) => <Timeline item={item} />,
};
