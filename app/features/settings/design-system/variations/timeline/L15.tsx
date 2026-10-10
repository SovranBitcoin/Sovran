import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** Money first: on a failure the reassurance leads, the cause and the steps come after. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const index = at === -1 ? item.steps.length - 1 : at;
  const current = item.steps[index];
  const problem = item.tone === 'problem';
  const sentences = (current?.detail ?? '')
    .split('. ')
    .map((part) => part.replace(/\.$/, ''))
    .filter(Boolean);
  const lead = problem && sentences.length > 1 ? sentences[sentences.length - 1] : undefined;
  const rest = lead ? sentences.slice(0, -1).join('. ') : (current?.detail ?? '');
  const where = [`Step ${index + 1} of ${item.steps.length}`, current?.title, current?.time]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={{ gap: 10 }}>
      {lead ? (
        <View
          style={{
            alignItems: 'center',
            backgroundColor: paint.chipFill,
            borderRadius: 14,
            flexDirection: 'row',
            gap: 10,
            padding: 14,
          }}>
          <Icon name="mdi:shield-check" size={26} color={success} />
          <Text size={18} bold family="mona" color={paint.text.primary} style={{ flex: 1 }}>
            {lead}
          </Text>
        </View>
      ) : null}
      <View style={{ gap: 3 }}>
        <Text
          size={lead ? 15 : 20}
          bold={!lead}
          semibold={Boolean(lead)}
          family="mona"
          color={problem ? danger : item.tone === 'success' ? success : paint.text.primary}>
          {item.headline}
        </Text>
        {rest ? (
          <Text size={14} color={paint.text.secondary}>
            {rest}
          </Text>
        ) : null}
        <Text size={12} color={paint.text.tertiary}>
          {where}
        </Text>
      </View>
    </View>
  );
}

export const L15: Variant<TimelineCase> = {
  id: 'L15',
  name: 'Money first',
  idea: 'When something fails, "your money was not spent" is the largest thing on screen, above the verdict and the cause.',
  render: (item) => <Timeline item={item} />,
};
