import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** A breadcrumb trail of step names, the current one emphasised, with its note beneath. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const index = at === -1 ? item.steps.length - 1 : at;
  const current = item.steps[index];
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const note = [current?.detail, current?.time].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: 8 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 }}>
        {item.steps.map((step, position) => (
          <View
            key={step.title}
            style={{ alignItems: 'center', flexDirection: 'row', maxWidth: '100%' }}>
            {position > 0 ? (
              <Icon name="mdi:chevron-right" size={16} color={paint.text.tertiary} />
            ) : null}
            <Text
              size={position === index ? 16 : 14}
              bold={position === index}
              color={
                position === index
                  ? tone
                  : position < index
                    ? paint.text.secondary
                    : paint.text.tertiary
              }
              style={{ flexShrink: 1 }}>
              {step.title}
            </Text>
          </View>
        ))}
      </View>
      {note ? (
        <Text size={13} color={paint.text.secondary}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export const L14: Variant<TimelineCase> = {
  id: 'L14',
  name: 'Breadcrumb',
  idea: 'The steps are a single wrapped line of names with the current one emphasised, taking the least height of any layout.',
  render: (item) => <Timeline item={item} />,
};
