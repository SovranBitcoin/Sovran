/**
 * @fileoverview Accelerate section for an unconfirmed onchain send.
 *
 * Offers the mempool.space Transaction Accelerator as a one-tap purchase:
 * "Accelerate for $x.xx / x sats" with the expected new confirmation time.
 * Tapping hands the caller a beat to create the Lightning invoice and route
 * it into the normal send flow. Once mempool.space acknowledges the txid the
 * section flips to a passive "Accelerating" state. A slow accent sheen sweeps
 * the card to set it apart from the static detail sections without shouting.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import { formatAmount } from '@/shared/lib/currency';
import { paymentLog } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from 'assets/icons';

const SHEEN_DURATION_MS = 2600;
const SHEEN_GAP_MS = 2000;
const SHEEN_WIDTH_RATIO = 0.6;

interface AccelerateOfferDisplay {
  totalSats: number;
  etaMinutes: number;
}

interface AccelerateSectionProps {
  /** Priced offer; null hides the CTA (paired with `accelerating` state). */
  offer: AccelerateOfferDisplay | null;
  /** mempool.space has acknowledged the acceleration. */
  accelerating: boolean;
  /** Create the invoice + open the lightning payment flow. */
  onAccelerate: () => Promise<void>;
}

export function AccelerateSection({ offer, accelerating, onAccelerate }: AccelerateSectionProps) {
  const [accent, foreground] = useThemeColor(['accent', 'foreground'] as const);
  const [busy, setBusy] = useState(false);

  const handlePress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    paymentLog.info('send.onchain.accelerate.pressed', {});
    try {
      await onAccelerate();
    } finally {
      setBusy(false);
    }
  }, [busy, onAccelerate]);

  if (!offer && !accelerating) return null;

  const fiat = offer
    ? formatAmount({ amount: offer.totalSats, unit: 'sat' }, { displayAs: 'usd' })
    : null;
  const sats = offer ? formatAmount({ amount: offer.totalSats, unit: 'sat' }) : null;

  return (
    <GradientCard style={styles.card} contentStyle={styles.cardContent} variant="right">
      <Pressable
        haptics
        accessibilityRole="button"
        accessibilityLabel={accelerating ? 'Accelerating transaction' : 'Accelerate transaction'}
        disabled={accelerating || busy}
        onPress={() => void handlePress()}
        style={styles.row}>
        <HStack align="center" spacing={12}>
          <Icon name="mdi:lightning-bolt" size={22} color={accent} />
          <VStack spacing={2} style={styles.textColumn}>
            {accelerating ? (
              <>
                <Text size={15} bold color={foreground}>
                  Accelerating
                </Text>
                <Text size={12} color={opacity(foreground, 0.5)}>
                  Miners are prioritizing this transaction
                </Text>
              </>
            ) : (
              <>
                <Text size={15} bold color={foreground}>
                  {busy ? 'Preparing invoice…' : `Accelerate for ${fiat} / ${sats} sats`}
                </Text>
                <Text size={12} color={opacity(foreground, 0.5)}>
                  Cuts confirmation time to ≈{offer!.etaMinutes} min · mempool.space
                </Text>
              </>
            )}
          </VStack>
          {!accelerating && (
            <Icon name="lucide:arrow-up-right" size={16} color={opacity(foreground, 0.5)} />
          )}
        </HStack>
      </Pressable>
      <AccelerateSheen color={accent} />
    </GradientCard>
  );
}

/** A soft accent highlight that sweeps the card, pauses, and repeats. */
function AccelerateSheen({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(0);
    progress.set(
      withRepeat(
        withDelay(
          SHEEN_GAP_MS,
          withTiming(1, { duration: SHEEN_DURATION_MS, easing: Easing.inOut(Easing.cubic) })
        ),
        -1,
        false
      )
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    setWidth((prev) => (prev === w ? prev : w));
  }, []);

  const sheenWidth = Math.max(60, Math.round(width * SHEEN_WIDTH_RATIO));
  const sheenStyle = useAnimatedStyle(() => {
    const translateX = interpolate(progress.get(), [0, 1], [-sheenWidth, width + sheenWidth]);
    return { transform: [{ translateX }] };
  });

  return (
    <View pointerEvents="none" onLayout={handleLayout} style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.sheenBar, { width: sheenWidth }, sheenStyle]}>
        <LinearGradient
          colors={[opacity(color, 0), opacity(color, 0.1), opacity(color, 0)]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  cardContent: {
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  textColumn: {
    flex: 1,
  },
  sheenBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
});
