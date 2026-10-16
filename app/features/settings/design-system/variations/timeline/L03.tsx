import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

function sentence(item: TimelineCase): string {
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const index = at === -1 ? item.steps.length - 1 : at;
  const step = item.steps[index];
  if (!step) return `${item.headline}.`;
  const next = item.steps[index + 1];
  const parts = [step.time ? `${step.title}, ${step.time}` : step.title];
  if (step.detail) parts.push(step.detail.replace(/\.$/, ''));
  if (next) parts.push(`Next: ${next.title}`);
  else if (step.state === 'done') parts.push('Nothing left to do');
  return `${parts.join('. ')}.`;
}

/** One paragraph of plain language, written from the steps, and nothing else. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.tertiary;
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ backgroundColor: tone, borderRadius: 2, width: 3 }} />
      <Text size={17} color={paint.text.primary} style={{ flex: 1, lineHeight: 25 }}>
        {sentence(item)}
      </Text>
    </View>
  );
}

export const L03: Variant<TimelineCase> = {
  id: 'L03',
  name: 'Plain sentence',
  idea: 'The whole timeline is one short paragraph a person could read aloud: what happened, why, and what comes next.',
  render: (item) => <Timeline item={item} />,
};
