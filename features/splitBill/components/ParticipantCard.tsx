/**
 * @fileoverview Participant card for the split-bill detail deck.
 *
 * Visual: full-bleed seeded gradient (deterministic from the participant's
 * pubkey / peerID / id — same math the profile banner uses via
 * `generateSeededGradient`) with the avatar, display name, "asking X sat"
 * caption, and a scannable BOLT11 QR stacked on top. The QR uses the same
 * `AnimatedQRCode` component the receive screens use (dark gradient wrap +
 * centered currency logo), sized for the card.
 *
 * Content-driven height: the card has no fixed `height` prop. It stretches
 * horizontally to fill whatever slot the deck gives it (snap stride), but
 * grows vertically to fit the avatar / title / QR / View pill stack with
 * generous padding. The deck's outer ScrollView absorbs the tallest card's
 * rendered height.
 *
 * Footer: a tappable "View" pill that navigates to the receive detail route
 * for the underlying coco `MintHistoryEntry` — the same destination
 * `Transaction` rows on the wallet home point to.
 *
 * State treatments:
 *   - `paymentState === 'paid'`    → QR dims to 0.4 and a ✓ chip overlays.
 *   - `paymentState === 'expired'` → QR dims + "Expired" label on the View pill.
 *   - `deliveryState === 'failed'` + no bolt11 → QR swapped for a retry CTA.
 *   - no bolt11 yet                → spinner placeholder.
 */

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { getContrastColors, useDominantColor } from '@/shared/lib/colorExtraction';
import { AnimatedQRCode } from '@/shared/ui/composed/QRCode';
import { Log } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { BITCOIN_ACCENT } from '@/shared/lib/brandColors';
import { duration } from '@/shared/styles/tokens';
import type {
  SplitBillGroup,
  SplitBillParticipant,
} from '@/shared/stores/profile/splitBillTransactionsStore';

interface ParticipantCardProps {
  group: SplitBillGroup;
  participant: SplitBillParticipant;
  /** Called when the user taps the retry CTA on a failed card. */
  onRetry?: (participantId: string) => void;
  /**
   * Called when the user taps the "View" pill. Expected to navigate to the
   * mint-quote detail screen — same destination `Transaction` rows use on
   * the wallet home.
   */
  onView?: (participantId: string) => void;
}

const QR_BLOCK_SIZE = 176;

export function ParticipantCard({
  group,
  participant,
  onRetry,
  onView,
}: ParticipantCardProps): React.ReactElement {
  // Seed priority mirrors how the profile banner keys gradients: prefer the
  // most stable public identifier so two sessions looking at the same bill
  // render the same colours. Fall back to the participant id (stable within
  // the group) for search-sourced contacts with no pubkey yet.
  const seed = participant.pubkey ?? participant.peerID ?? participant.id;
  const theme = useMemo(() => generateSeededGradient(seed), [seed]);

  // Extract a dominant colour from the participant's avatar image when one
  // is available — same pattern `UserProfileScreen.tsx` uses to paint its
  // banner: `useDominantColor` → `getContrastColors` → two-stop gradient.
  // Falls back to the seeded gradient above while extraction is in-flight
  // or when no image exists (search-sourced contacts, BLE peers, etc.).
  const pfpColors = useDominantColor(participant.avatarUrl, 0);
  const imageGradient = useMemo(() => {
    if (!participant.avatarUrl || !pfpColors.hasExtractedColors) return null;
    const { contrastColor } = getContrastColors(pfpColors.baseColor, 0.3);
    return [pfpColors.baseColor, contrastColor] as readonly [string, string];
  }, [participant.avatarUrl, pfpColors.hasExtractedColors, pfpColors.baseColor]);

  const isPaid = participant.paymentState === 'paid';
  const isExpired = participant.paymentState === 'expired';
  const isFailed = participant.deliveryState === 'failed';
  const isSelf = participant.source === 'self' || participant.channel === 'self';
  const qrDimmed = isPaid || isExpired;
  const canView = !!participant.mintQuoteId && !!onView;

  const title = participant.nickname ?? seed.slice(0, 12);

  // Internal (`self`) participants are paid via an internal coco transfer —
  // there's no Lightning invoice to share. Show a different placeholder
  // (avatar glyph + "Sending to @name…") instead of the spinner-and-
  // "Generating invoice…" copy that confused the user during testing.
  const qrBody = participant.bolt11 ? (
    <View style={{ opacity: qrDimmed ? 0.4 : 1 }}>
      <AnimatedQRCode
        unit={group.unit}
        address={participant.bolt11}
        size={QR_BLOCK_SIZE}
        padding={10}
      />
    </View>
  ) : isSelf ? (
    <View style={styles.qrPlaceholder}>
      <Icon name="mdi:account-arrow-right" size={32} color="rgba(255,255,255,0.85)" />
      <Text size={12} style={{ color: 'rgba(255,255,255,0.85)', marginTop: 8 }}>
        {`Sending to ${title}…`}
      </Text>
    </View>
  ) : (
    <View style={styles.qrPlaceholder}>
      <Icon
        name="ant-design:loading-outlined"
        size={28}
        color="rgba(255,255,255,0.75)"
        spin={{
          duration: duration.spin,
          outputRange: ['0deg', '360deg'],
          delay: 0,
          easing: 'linear',
        }}
      />
      <Text size={12} style={{ color: 'rgba(255,255,255,0.75)', marginTop: 8 }}>
        Generating invoice…
      </Text>
    </View>
  );

  const retryCTA = (
    <Pressable
      onPress={onRetry ? () => onRetry(participant.id) : undefined}
      accessibilityRole="button"
      accessibilityLabel={`Retry delivery to ${title}`}
      style={({ pressed }) => [
        styles.retryCTA,
        { backgroundColor: opacity('#FFFFFF', pressed ? 0.35 : 0.2) },
      ]}
      testID={`split-bill-card-retry-${participant.id}`}>
      <HStack align="center" spacing={8}>
        <Icon name="mdi:refresh" size={18} color="#FFFFFF" />
        <Text size={13} bold color="#FFFFFF">
          Tap to retry delivery
        </Text>
      </HStack>
    </Pressable>
  );

  const viewLabel = isPaid ? 'View · Paid' : isExpired ? 'View · Expired' : 'View';

  return (
    <Log name="ParticipantCard">
      <View style={styles.card} testID={`split-bill-card-${participant.id}`}>
        {/* Card background — dimmed to 0.25 opacity so the orange
            "asking" pill doesn't vibrate against a fully saturated hue.
            When the participant has an avatar image we tint with a
            two-stop gradient of the image's dominant colour + its
            contrast derivative (matches the profile-banner look from
            `UserProfileScreen.tsx:421-431`). Otherwise we fall back to
            the deterministic seeded gradient so BLE peers and no-avatar
            contacts still get a distinct tint. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.25 }]}>
          {imageGradient ? (
            <LinearGradient
              colors={imageGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <>
              <LinearGradient
                colors={theme.primaryColors}
                start={theme.primaryStart}
                end={theme.primaryEnd}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={theme.overlayColors}
                start={theme.overlayStart}
                end={theme.overlayEnd}
                style={StyleSheet.absoluteFill}
              />
            </>
          )}
        </View>

        <VStack align="center" style={styles.content}>
          {/* Header: avatar + name + "asking <amount>" row */}
          <VStack align="center" spacing={10} style={{ width: '100%' }}>
            <Avatar
              state={participant.avatarUrl ? 'image' : 'fallback'}
              picture={participant.avatarUrl}
              name={participant.nickname}
              seed={seed}
              size={52}
            />
            <Text size={17} bold color="#FFFFFF" numberOfLines={1}>
              {title}
            </Text>
            {/* Asking-amount pill — matches the shape of the "View" pill
                below the QR, tinted bitcoin-orange so the amount reads as
                an accent rather than a subtitle. `AmountFormatter` already
                renders the ₿ glyph (or lightning glyph, depending on the
                user's display preference) next to the number. */}
            <View style={styles.askingPill}>
              <AmountFormatter
                amount={participant.amount}
                unit={group.unit}
                size={14}
                weight="heavy"
                color="#FFFFFF"
              />
            </View>
          </VStack>

          {/* QR slot — generous vertical margin so the QR has breathing
              room on all sides regardless of card height. */}
          <View style={styles.qrSlot}>
            {isFailed && !participant.bolt11 ? retryCTA : qrBody}
            {isPaid ? (
              <View style={styles.paidBadge}>
                <Icon name="mdi:check-circle" size={28} color="#34C759" />
              </View>
            ) : null}
          </View>

          {/* View button — links to the same destination a Transaction row
              on the wallet home points to. Text-only; a trailing arrow glyph
              felt cluttered next to the QR. */}
          <Pressable
            onPress={canView ? () => onView(participant.id) : undefined}
            disabled={!canView}
            accessibilityRole="button"
            accessibilityLabel={`${viewLabel} for ${title}`}
            accessibilityState={{ disabled: !canView }}
            style={({ pressed }) => [
              styles.viewButton,
              {
                backgroundColor: opacity('#FFFFFF', !canView ? 0.1 : pressed ? 0.38 : 0.22),
              },
            ]}
            testID={`split-bill-card-view-${participant.id}`}>
            <Text size={13} bold color="#FFFFFF">
              {viewLabel}
            </Text>
          </Pressable>
        </VStack>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    alignSelf: 'stretch',
  },
  content: {
    paddingVertical: 28,
    paddingHorizontal: 32,
    gap: 22,
  },
  qrSlot: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  qrPlaceholder: {
    width: QR_BLOCK_SIZE,
    height: QR_BLOCK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 16,
  },
  retryCTA: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    minWidth: QR_BLOCK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paidBadge: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 2,
  },
  viewButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  askingPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BITCOIN_ACCENT,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
