import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** The step number as a large numeral, with the step it names beside it. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const index = at === -1 ? item.steps.length - 1 : at;
  const current = item.steps[index];
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  return (
    <View style={{ flexDirection: 'row', gap: 16 }}>
      <View style={{ alignItems: 'center', minWidth: 56 }}>
        <Text size={56} bold family="mona" color={tone} style={{ lineHeight: 60 }}>
          {index + 1}
        </Text>
        <Text size={13} medium color={paint.text.tertiary}>
          {`of ${item.steps.length}`}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 3, justifyContent: 'center' }}>
        <Text size={18} semibold color={paint.text.primary}>
          {current?.title ?? item.headline}
        </Text>
        {current?.detail ? (
          <Text size={14} color={paint.text.secondary}>
            {current.detail}
          </Text>
        ) : null}
        {current?.time ? (
          <Text size={12} color={paint.text.tertiary}>
            {current.time}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const L10: Variant<TimelineCase> = {
  id: 'L10',
  name: 'Big numeral',
  idea: 'The step number is the hero ("2 of 3"), on the bet that people count progress before they read it.',
  render: (item) => <Timeline item={item} />,
};
