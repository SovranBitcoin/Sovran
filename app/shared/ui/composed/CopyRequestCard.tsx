/**
 * @fileoverview Copyable payment-request row (rail icon · truncated value ·
 * copy glyph) shared by the receive rails, plus the Section/GradientCard
 * chrome the rail tabs wrap it in. Press handling stays with the caller —
 * each rail copies through its own clipboard/log/actions path.
 */

import type { ReactNode } from 'react';
import { ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { View } from '@/shared/ui/primitives/View/View';

interface CopyRequestRowProps {
  /**
   * Leading glyph naming the rail (qr, lightning, coins, …) — an icon name
   * rendered muted, or a ready element for non-Icon prefixes (currency
   * glyphs on ShareScreen).
   */
  icon: string | ReactNode;
  /** Truncated display string for the request/address. */
  display: string;
  /** Muted theme color threaded from the screen's batched lookup. */
  muted: string;
  onPress: () => void | Promise<void>;
  testID?: string;
  accessibilityLabel?: string;
}

export function CopyRequestRow({
  icon,
  display,
  muted,
  onPress,
  testID,
  accessibilityLabel,
}: CopyRequestRowProps) {
  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix className="shrink-0">
            {typeof icon === 'string' ? <Icon name={icon} size={20} color={muted} /> : icon}
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent className="min-w-0 flex-1">
            <ListGroup.ItemTitle numberOfLines={1} ellipsizeMode="middle">
              {display}
            </ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix className="shrink-0">
            <Icon name="lets-icons:copy" size={20} color={muted} />
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

export function CopyRequestCard({ title, ...row }: CopyRequestRowProps & { title: string }) {
  return (
    <View className="mx-4">
      <Section title={title}>
        <GradientCard>
          <ListGroup variant="transparent">
            <CopyRequestRow {...row} />
          </ListGroup>
        </GradientCard>
      </Section>
    </View>
  );
}
