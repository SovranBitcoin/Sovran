/**
 * @fileoverview Copyable payment-request row shared by the receive rails and
 * ShareScreen: rail icon · name · one line of monospace code · copy glyph.
 * The code (`formatVerifiableValue`: `head ···· tail`) lets the user check
 * what the copy puts on their clipboard. The name is primary colour, the code
 * smaller and off-primary. The caller owns the press.
 */

import type { ReactNode } from 'react';
import { ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { formatVerifiableValue, type VerifiableKind } from '@/shared/lib/format/verifiableValue';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

interface CopyPart {
  /** Names the value ("Onchain", "BOLT 12") in the row's primary colour. */
  label?: string;
  /** The code to verify. Omit it for a row whose value is too composite to
   *  check by eye (the Unified link) and give a `description` instead. */
  value?: string;
  /** Plain words shown in the code's slot when there is no `value`. */
  description?: string;
  /** Default `code` (shown as `head ···· tail`); `lightningAddress` keeps
   *  the `@domain` whole. */
  kind?: VerifiableKind;
}

interface CopyRequestRowProps {
  /**
   * Leading glyph naming the rail (qr, lightning, coins, …) — an icon name
   * rendered muted, or a ready element for non-Icon prefixes (currency
   * glyphs on ShareScreen).
   */
  icon: string | ReactNode;
  parts: CopyPart[];
  /** Muted theme color threaded from the screen's batched lookup. */
  muted: string;
  /** Value still being built: keep each part's label; a skeleton the size of
   *  the code line holds its place, so nothing shifts when it lands. */
  loading?: boolean;
  onPress?: () => void | Promise<void>;
  testID?: string;
  accessibilityLabel?: string;
}

export function CopyRequestRow({
  icon,
  parts,
  muted,
  loading = false,
  onPress,
  testID,
  accessibilityLabel,
}: CopyRequestRowProps) {
  const foreground = useThemeColor('foreground');
  // Off-primary: the value reads as data beside its primary-colour name.
  const code = withAlpha(foreground, 0.62);
  return (
    <PressableFeedback
      animation={false}
      isDisabled={!onPress}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !onPress, busy: loading }}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled className="items-start">
          <ListGroup.ItemPrefix className="shrink-0 pt-0.5">
            {typeof icon === 'string' ? <Icon name={icon} size={20} color={muted} /> : icon}
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent className="min-w-0 flex-1 gap-3">
            {(parts.length > 0 ? parts : [{ value: '' }]).map((part, index) => (
              <View key={part.label ?? index} className="gap-1">
                {part.label ? (
                  <Text size={15} medium color={foreground}>
                    {part.label}
                  </Text>
                ) : null}
                <View className="h-[18px] justify-center">
                  {loading ? (
                    <Skeleton className="h-3 w-40 rounded" />
                  ) : part.value === undefined ? (
                    <Text size={12} color={code} numberOfLines={1} className="leading-[18px]">
                      {part.description}
                    </Text>
                  ) : (
                    <Text
                      family="mono"
                      size={12}
                      color={code}
                      numberOfLines={1}
                      // A narrow screen clips the middle, never an end: the
                      // ends (and a Lightning address's domain) are the check.
                      ellipsizeMode="middle"
                      className="leading-[18px]"
                      testID="copy-request-value">
                      {formatVerifiableValue(part.value, part.kind)}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix className="shrink-0 pt-0.5">
            <Icon name="lets-icons:copy" size={20} color={foreground} />
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
