/**
 * Android tap-to-pay sheet — the visible face of the NFC flow.
 *
 * Android has no system NFC sheet (iOS shows "Ready to Scan"), so without
 * this the phone listened silently for up to 30s and gave up without a
 * trace. The sheet shows a pulsing NFC glyph with live phase text driven by
 * nfcTapStore: 'armed' (listening) → 'reading' (tag in field) →
 * 'selecting'/'creating'/'writing' (colada onNfcPaymentProgress).
 *
 * Listening itself is owned by the ambient wallet-screen loop
 * (useAmbientNfcArm) — dismissing this sheet only hides the UI; the
 * listener stays armed while the wallet is focused ("technically always
 * on", per design). Lives in the custom-sheet lane because the NFC button
 * also exists inside send-flow route modals.
 */

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { paymentLog } from '@/shared/lib/logger';
import { useNfcTapStore, type NfcTapPhase } from '@/shared/stores/runtime/nfcTapStore';
import { fontSize, spacing } from '@/shared/styles/tokens';
import type { CustomSheetSharedProps } from '@/shared/lib/popup/sheets/types';

const GLYPH_CIRCLE = 96;
const RING_MAX_SCALE = 1.55;
const PULSE_MS = 1600;

const PHASE_TEXT: Record<NfcTapPhase, { title: string; subtitle: string }> = {
  armed: {
    title: 'Hold near a payment terminal',
    subtitle: 'Your phone is listening for NFC',
  },
  reading: {
    title: 'Reading payment request…',
    subtitle: 'Keep holding your phone in place',
  },
  selecting: {
    title: 'Preparing payment…',
    subtitle: 'Keep holding your phone in place',
  },
  creating: {
    title: 'Sending payment…',
    subtitle: "Keep holding — don't move your phone",
  },
  writing: {
    title: 'Sending payment…',
    subtitle: "Keep holding — don't move your phone",
  },
};

export function NfcTapContent({ close, setFooterConfig }: CustomSheetSharedProps) {
  const phase = useNfcTapStore((s) => s.phase);
  const [foreground, surfaceSecondary, accent] = useThemeColor([
    'foreground',
    'surface-secondary',
    'accent',
  ] as const);

  useEffect(() => {
    setFooterConfig({
      buttons: [
        {
          label: 'Close',
          onPress: () => {
            paymentLog.info('nfc.tap_sheet.close_press', { phase });
            close();
          },
          variant: 'tertiary',
        },
      ],
    });
    paymentLog.info('nfc.tap_sheet.footer_attach', { phase });
    return () => {
      paymentLog.info('nfc.tap_sheet.footer_detach', { phase });
      setFooterConfig(null);
    };
  }, [close, phase, setFooterConfig]);

  // Expanding radar ring behind the glyph — scale up while fading out, on
  // repeat. Drives only transform/opacity, so it stays on the UI thread.
  const pulse = useSharedValue(0);
  useEffect(() => {
    paymentLog.debug('nfc.tap_sheet.pulse_start', { phase });
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }),
      -1,
      false
    );
    return () => {
      paymentLog.debug('nfc.tap_sheet.pulse_stop', { phase });
      pulse.value = 0;
    };
  }, [phase, pulse]);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * (RING_MAX_SCALE - 1) }],
    opacity: 0.5 * (1 - pulse.value),
  }));

  const { title, subtitle } = PHASE_TEXT[phase];
  useEffect(() => {
    paymentLog.debug('nfc.tap_sheet.phase_render', {
      phase,
      titleLength: title.length,
      subtitleLength: subtitle.length,
    });
  }, [phase, subtitle.length, title.length]);

  return (
    <VStack align="center" gap={spacing.md} style={styles.body}>
      <View style={styles.glyphArea}>
        <Animated.View
          style={[styles.ring, { backgroundColor: withAlpha(accent, 0.4) }, ringStyle]}
        />
        <View style={[styles.glyphCircle, { backgroundColor: surfaceSecondary }]}>
          <Icon name="lucide:nfc" size={44} color={foreground} />
        </View>
      </View>
      <Text bold size={fontSize['2xl']} style={styles.title}>
        {title}
      </Text>
      <Text size={fontSize.md} color={withAlpha(foreground, 0.6)} style={styles.title}>
        {subtitle}
      </Text>
    </VStack>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  glyphArea: {
    width: GLYPH_CIRCLE * RING_MAX_SCALE,
    height: GLYPH_CIRCLE * RING_MAX_SCALE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: GLYPH_CIRCLE,
    height: GLYPH_CIRCLE,
    borderRadius: GLYPH_CIRCLE / 2,
  },
  glyphCircle: {
    width: GLYPH_CIRCLE,
    height: GLYPH_CIRCLE,
    borderRadius: GLYPH_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
});
