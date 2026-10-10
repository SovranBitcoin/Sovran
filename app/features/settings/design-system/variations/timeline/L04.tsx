import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

function count(n: number, suffix: string): string {
  return `${n} ${n === 1 ? 'step' : 'steps'} ${suffix}`;
}

/** Only the current step, large; everything before and after is a count. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const index = at === -1 ? item.steps.length - 1 : at;
  const current = item.steps[index];
  const before = index;
  const after = item.steps.length - index - 1;
  const next = item.steps[index + 1];
  const color =
    current?.state === 'failed' ? danger : item.tone === 'success' ? success : paint.text.primary;
  return (
    <View style={{ gap: 8 }}>
      {before > 0 ? (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          <Icon name="mdi:check" size={14} color={paint.text.tertiary} />
          <Text size={13} color={paint.text.tertiary}>
            {count(before, 'done')}
          </Text>
        </View>
      ) : null}
      <View style={{ gap: 4 }}>
        <Text size={26} bold family="mona" color={color}>
          {current?.title ?? item.headline}
        </Text>
        {current?.detail ? (
          <Text size={15} color={paint.text.secondary}>
            {current.detail}
          </Text>
        ) : null}
        {current?.time ? (
          <Text size={13} color={paint.text.tertiary}>
            {current.time}
          </Text>
        ) : null}
      </View>
      {next ? (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          <Icon name="mdi:arrow-down" size={14} color={paint.text.tertiary} />
          <Text size={13} color={paint.text.tertiary} style={{ flex: 1 }}>
            {after === 1 ? `Then: ${next.title}` : `${count(after, 'to go')}, next ${next.title}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const L04: Variant<TimelineCase> = {
  id: 'L04',
  name: 'Current step',
  idea: 'Only the step you are on is shown, large; earlier and later steps collapse to a count.',
  render: (item) => <Timeline item={item} />,
};
