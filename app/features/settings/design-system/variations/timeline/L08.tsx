import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** A large state glyph, the verdict under it, and one caption line. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const current = item.steps.find((step) => step.state === 'active' || step.state === 'failed');
  const last = item.steps[item.steps.length - 1];
  const glyph =
    item.tone === 'success'
      ? 'mdi:check'
      : item.tone === 'problem'
        ? 'mdi:close'
        : item.tone === 'progress'
          ? 'mdi:clock-outline'
          : current
            ? 'mdi:arrow-right'
            : 'mdi:minus';
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const caption = current?.detail ?? last?.detail ?? last?.time;
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: paint.chipFill,
          borderRadius: 36,
          height: 72,
          justifyContent: 'center',
          width: 72,
        }}>
        <Icon name={glyph} size={36} color={tone} />
      </View>
      <Text size={20} bold family="mona" color={paint.text.primary} style={{ textAlign: 'center' }}>
        {item.headline}
      </Text>
      {caption ? (
        <Text size={14} color={paint.text.secondary} style={{ textAlign: 'center' }}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

export const L08: Variant<TimelineCase> = {
  id: 'L08',
  name: 'Glyph',
  idea: 'The state is a single large symbol recognised before any word is read, with the verdict and one caption beneath.',
  render: (item) => <Timeline item={item} />,
};
