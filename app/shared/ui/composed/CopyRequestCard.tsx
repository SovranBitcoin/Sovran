/**
 * @fileoverview Copyable payment-request row (rail icon · truncated value ·
 * copy glyph) shared by the receive rails, plus the Section/GradientCard
 * chrome the rail tabs wrap it in. Press handling stays with the caller —
 * each rail copies through its own clipboard/log/actions path.
 *
 * The value decodes in cipher-style (`ScrambleText`): a `loading` row keeps
 * scrambling a value-width string until the real one lands, and a row whose
 * value just arrived from a fetch (`reveal`) settles its glyphs left → right.
 * A row mounted with data it already had shows it immediately.
 */

import type { ReactNode } from 'react';
import { ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { ScrambleText } from '@/shared/ui/primitives/ScrambleText';
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
  /** Value still being built: keep scrambling a value-width placeholder. */
  loading?: boolean;
  /** `display` just landed from a lazy fetch: play the decode once on mount. */
  reveal?: boolean;
  onPress?: () => void | Promise<void>;
  testID?: string;
  accessibilityLabel?: string;
}

export function CopyRequestRow({
  icon,
  display,
  muted,
  loading = false,
  reveal = false,
  onPress,
  testID,
  accessibilityLabel,
}: CopyRequestRowProps) {
  return (
    <PressableFeedback
      animation={false}
      isDisabled={!onPress}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix className="shrink-0">
            {typeof icon === 'string' ? <Icon name={icon} size={20} color={muted} /> : icon}
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent className="min-w-0 flex-1">
            {/* Same type as ListGroup.ItemTitle (text-base / font-medium /
                foreground), rendered through the UI-thread readout. */}
            <ScrambleText
              text={loading ? '' : display}
              reveal={reveal}
              testID="copy-request-value"
            />
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
