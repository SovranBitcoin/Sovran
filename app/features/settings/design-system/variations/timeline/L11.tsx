import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Text } from '@/shared/ui/primitives/Text';

import type { TimelineCase } from '../timelineCases';
import type { Variant } from '../types';

/** Three fixed rows, then / now / next, whatever the number of steps. */
function Timeline({ item }: { item: TimelineCase }) {
  const paint = useStylePaint();
  const [success, danger] = useThemeColor(['success', 'danger'] as const);
  const at = item.steps.findIndex((step) => step.state === 'active' || step.state === 'failed');
  const index = at === -1 ? item.steps.length - 1 : at;
  const before = item.steps[index - 1];
  const current = item.steps[index];
  const after = item.steps[index + 1];
  const tone =
    item.tone === 'success' ? success : item.tone === 'problem' ? danger : paint.text.primary;
  const label = (text: string) => (
    <Text size={11} semibold color={paint.text.tertiary} style={{ paddingTop: 3, width: 44 }}>
      {text}
    </Text>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 12, paddingBottom: 10 }}>
        {label('THEN')}
        <Text size={14} color={paint.text.secondary} style={{ flex: 1 }}>
          {before
            ? before.time
              ? `${before.title} · ${before.time}`
              : before.title
            : 'Nothing before this'}
        </Text>
      </View>
      <View
        style={{
          borderBottomColor: paint.divider,
          borderBottomWidth: 1,
          borderTopColor: paint.divider,
          borderTopWidth: 1,
          flexDirection: 'row',
          gap: 12,
          paddingVertical: 12,
        }}>
        {label('NOW')}
        <View style={{ flex: 1, gap: 2 }}>
          <Text size={18} bold family="mona" color={tone}>
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
      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 10 }}>
        {label('NEXT')}
        <Text size={14} color={paint.text.secondary} style={{ flex: 1 }}>
          {after
            ? after.title
            : current?.state === 'failed'
              ? 'Stopped here'
              : 'Nothing left to do'}
        </Text>
      </View>
    </View>
  );
}

export const L11: Variant<TimelineCase> = {
  id: 'L11',
  name: 'Then now next',
  idea: 'Always exactly three labelled rows, the step before, the step now and the step after, however long the payment is.',
  render: (item) => <Timeline item={item} />,
};
