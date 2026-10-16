import { View } from 'react-native';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** Led by time: the waiting line first, then when it started, when it last moved, what is left. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const active = item.steps.find((step) => step.state === 'active');
  const times = item.steps.flatMap((step) => (step.time ? [step.time] : []));
  const left = item.steps.filter((step) => step.state === 'todo').length;
  const waiting = active !== undefined;
  const facts = [
    { label: 'Started', value: times[0] ?? 'Not yet' },
    { label: waiting ? 'Last update' : 'Ended', value: times[times.length - 1] ?? 'None' },
    {
      label: 'Still to do',
      value: left === 0 ? (waiting ? 'This step' : 'Nothing') : `${left + 1} steps`,
    },
  ];
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          <Icon name="mdi:clock-outline" size={14} color={tone} />
          <Text size={13} semibold color={tone}>
            {item.headline}
          </Text>
        </View>
        <Text size={20} semibold family="mona" color={paint.text.primary}>
          {active?.detail ?? active?.title ?? item.steps[item.steps.length - 1]?.title ?? ''}
        </Text>
      </View>
      <View style={{ borderTopColor: paint.divider, borderTopWidth: 1, flexDirection: 'row' }}>
        {facts.map((fact) => (
          <View key={fact.label} style={{ flex: 1, gap: 2, paddingRight: 8, paddingTop: 10 }}>
            <Text size={11} color={paint.text.tertiary}>
              {fact.label}
            </Text>
            <Text size={13} medium numberOfLines={2} color={paint.text.secondary}>
              {fact.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export const L06: Variant<TimelineCase> = {
  id: 'L06',
  name: 'How long',
  idea: 'Answers "how long" first: the waiting line is the headline, with started, last update and what is left beneath it.',
  render: (item) => <Timeline item={item} />,
};
