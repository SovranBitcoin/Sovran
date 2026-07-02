/**
 * A row of equal-width tappable segments in a GradientCard — the same visual
 * contract as the animated-QR speed/density controls (icon + 13pt label at
 * 50% foreground, hairline dividers, 44pt min height), generalized so other
 * surfaces (e.g. the onchain "New address / View all" row) render identical
 * chrome.
 */

import React, { memo } from 'react';
import opacity from 'hex-color-opacity';
import { PressableFeedback } from 'heroui-native';

import Icon from 'assets/icons';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface ActionSegment {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
  /** Greyed-out rendering; the segment stays pressable so the handler can
   *  explain itself (e.g. a cooldown toast). */
  dimmed?: boolean;
}

export const ActionSegmentsCard = memo(function ActionSegmentsCard({
  segments,
}: {
  segments: ActionSegment[];
}) {
  const foreground = useThemeColor('foreground');
  const tint = (dimmed?: boolean) => opacity(foreground, dimmed ? 0.25 : 0.5);

  return (
    <GradientCard style={{ marginHorizontal: 16 }}>
      <HStack style={{ minHeight: 44 }}>
        {segments.map((segment, index) => (
          <React.Fragment key={segment.label}>
            {index > 0 && (
              <View
                style={{
                  width: 1,
                  backgroundColor: opacity(foreground, 0.08),
                  marginVertical: 10,
                }}
              />
            )}
            <PressableFeedback
              testID={segment.testID}
              animation={false}
              onPress={segment.onPress}
              style={{ flex: 1 }}>
              <PressableFeedback.Scale>
                <HStack align="center" justify="center" gap={6} style={{ paddingVertical: 12 }}>
                  <Icon name={segment.icon} size={16} color={tint(segment.dimmed)} />
                  <Text size={13} color={tint(segment.dimmed)}>
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
