/**
 * A row of equal-width tappable segments in a GradientCard — the same visual
 * contract as the animated-QR speed/density controls (icon + 13pt label at
 * 50% foreground, hairline dividers, 44pt min height), generalized so other
 * surfaces (e.g. the onchain "New address / View all" row) render identical
 * chrome.
 */

import React, { memo } from 'react';
import { withAlpha } from '@/shared/lib/color';
import { PressableFeedback } from 'heroui-native';

import Icon from 'assets/icons';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface ActionSegment {
  icon?: string;
  label: string;
  onPress: () => void;
  testID?: string;
  /** Greyed-out rendering; the segment stays pressable so the handler can
   *  explain itself (e.g. a cooldown toast). */
  dimmed?: boolean;
  /** Selected-mode rendering (full-opacity, bold) — for rows used as a
   *  visible 2-way mode switcher rather than one-shot actions. */
  active?: boolean;
}

export const ActionSegmentsCard = memo(function ActionSegmentsCard({
  segments,
}: {
  segments: ActionSegment[];
}) {
  const foreground = useThemeColor('foreground');
  // A row where any segment sets `active` is a mode switcher, so every
  // segment reports its selected state; one-shot action rows report none.
  const isSwitcher = segments.some((segment) => segment.active !== undefined);
  const tint = (segment: ActionSegment) =>
    segment.active ? foreground : withAlpha(foreground, segment.dimmed ? 0.25 : 0.5);

  return (
    <GradientCard style={{ marginHorizontal: 16 }}>
      <HStack style={{ minHeight: 44 }}>
        {segments.map((segment, index) => (
          <React.Fragment key={segment.testID ?? segment.label}>
            {index > 0 && (
              <View
                style={{
                  width: 1,
                  backgroundColor: withAlpha(foreground, 0.08),
                  marginVertical: 10,
                }}
              />
            )}
            <PressableFeedback
              testID={segment.testID}
              accessibilityRole="button"
              accessibilityLabel={segment.label}
              // `dimmed` stays pressable by design, so it is not `disabled`.
              accessibilityState={isSwitcher ? { selected: !!segment.active } : undefined}
              animation={false}
              onPress={segment.onPress}
              style={{ flex: 1 }}>
              <PressableFeedback.Scale>
                <HStack align="center" justify="center" gap={6} style={{ paddingVertical: 12 }}>
                  {segment.icon ? (
                    <Icon name={segment.icon} size={16} color={tint(segment)} />
                  ) : null}
                  <Text size={13} bold={segment.active} color={tint(segment)}>
                    {segment.label}
                  </Text>
                </HStack>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
          </React.Fragment>
        ))}
      </HStack>
    </GradientCard>
  );
});
