/**
 * One thing one mint did, as a notification row.
 *
 * Layout follows `NotificationsScreen`'s rows exactly — a small tinted glyph
 * saying what kind of event this is, the identity beside it, one sentence, and
 * a relative time — so a mint update sits in the same visual grammar as a like
 * or a follow. The glyph is the change's own (a bolt for a Lightning rail, a
 * key for a rotation); its tint says whether the mint gained or lost something.
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import Icon from '@/assets/icons';
import type { MintChangeUpdate } from '@/features/mint/lib/mintChanges/groupEntries';
import { mintChangeSentence, type MintChangeTone } from '@/features/mint/lib/mintChanges/phrase';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelative } from '@/shared/lib/date';
import { alpha, fontSize, radius, spacing } from '@/shared/styles/tokens';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const MINT_GLYPH_SIZE = 42;
const REASON_GLYPH_SIZE = 28;

/** Tone → theme colour. Kept here so the phrasing library stays UI-free. */
function useMintChangeToneColor(tone: MintChangeTone): string {
  const [success, danger, accent, warning, muted] = useThemeColor([
    'success',
    'danger',
    'accent',
    'warning',
    'muted',
  ] as const);
  if (tone === 'success') return success;
  if (tone === 'danger') return danger;
  if (tone === 'accent') return accent;
  if (tone === 'warning') return warning;
  return muted;
}

/** The tinted circle a notification row wears to say what kind of event it is. */
export function MintChangeGlyph({
  icon,
  tone,
  size = REASON_GLYPH_SIZE,
}: {
  icon: string;
  tone: MintChangeTone;
  size?: number;
}) {
  const color = useMintChangeToneColor(tone);
  return (
    <View
      style={[
        styles.reasonIcon,
        {
          backgroundColor: opacity(color, alpha.faint),
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}>
      <Icon name={icon} size={Math.round(size * 0.6)} color={color} />
    </View>
  );
}

export function MintChangeRow({
  update,
  onPress,
}: {
  update: MintChangeUpdate;
  onPress: (update: MintChangeUpdate) => void;
}) {
  const [foreground, muted, surfaceTertiary] = useThemeColor([
    'foreground',
    'muted',
    'surface-tertiary',
  ] as const);
  const metadata = useCachedMintMetadata(update.mintUrl);
  const pressedBackground = useMemo(() => opacity(surfaceTertiary, alpha.muted), [surfaceTertiary]);

  const timestamp = update.at > 0 ? formatRelative(update.at * 1000, 'compact') : '';
  const sentence = mintChangeSentence(update.name, update.phrase);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sentence}
      testID={`mint-change-row:${update.id}`}
      haptics
      activeOpacity={1}
      onPress={() => onPress(update)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: pressedBackground }]}>
      <HStack align="flex-start" gap={spacing.md}>
        <MintChangeGlyph icon={update.phrase.icon} tone={update.phrase.tone} />
        <MintIcon
          iconUrl={metadata?.iconUrl}
          name={update.name}
          size={MINT_GLYPH_SIZE}
          style={styles.mintIcon}
        />
        <VStack gap={2} flex={1}>
          <HStack align="flex-start" justify="space-between" gap={spacing.sm}>
            <Text
              numberOfLines={2}
              size={fontSize.lg}
              style={[styles.sentence, { color: foreground }]}>
              {sentence}
            </Text>
            {timestamp ? (
              <Text
                numberOfLines={1}
                size={fontSize.sm}
                style={[styles.timestamp, { color: muted }]}>
                {timestamp}
              </Text>
            ) : null}
          </HStack>
        </VStack>
      </HStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  reasonIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 7,
  },
  mintIcon: {
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  sentence: {
    flex: 1,
    minWidth: 0,
  },
  timestamp: {
    flexShrink: 0,
    paddingTop: 3,
  },
});
