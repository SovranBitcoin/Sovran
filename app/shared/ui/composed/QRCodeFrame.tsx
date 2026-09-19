import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import Icon, { CurrencyIcon } from 'assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { View } from '@/shared/ui/primitives/View/View';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import { qrPlaceholderFrames, type QrPlaceholderFrame } from '@/shared/lib/qrPlaceholderFrames';
import { SCRAMBLE_DECODE_MS } from '@/shared/lib/scrambleText';

export const PAYMENT_QR_PADDING = 32;
const FRAME_PADDING = 16;
const frameStyle = { borderRadius: 16, padding: FRAME_PADDING };
const contentStyle = { padding: FRAME_PADDING };

/** The QR module square plus its scanner quiet-zone/card frame. */
export function qrCodeGeometry(screenWidth: number, padding: number, size?: number) {
  const qrSize = Math.max(0, (size ?? Math.min(screenWidth, 600)) - 2 * padding);
  return { qrSize, frameSize: qrSize + 2 * FRAME_PADDING };
}

export function QRCodeFrame({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  return scheme === 'light' ? (
    <GradientCard contentStyle={contentStyle}>{children}</GradientCard>
  ) : (
    <LinearGradient colors={[INVARIANT_WHITE, INVARIANT_WHITE]} style={frameStyle}>
      {children}
    </LinearGradient>
  );
}

/** Junk density when the caller has no idea what it is loading — a mid-size
 * request (a creq or a short unified URI). */
const QR_PLACEHOLDER_DEFAULT_LENGTH = 200;
/** Frame hold. ~6 fps reads as a live code being (re)drawn; faster is noise. */
const QR_PLACEHOLDER_FRAME_MS = 160;

/** One pre-encoded junk frame. All frames stay mounted; the UI thread flips
 * which one is opaque, so nothing is re-encoded or re-parsed per frame. */
function PlaceholderFrameLayer({
  frame,
  index,
  activeIndex,
  size,
}: {
  frame: QrPlaceholderFrame;
  index: number;
  activeIndex: SharedValue<number>;
  size: number;
}) {
  const layerStyle = useAnimatedStyle(() => ({
    opacity: activeIndex.get() === index ? 1 : 0,
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, layerStyle]}>
      <Svg width={size} height={size}>
        <Path
          d={frame.d}
          stroke={INVARIANT_BLACK}
          strokeWidth={frame.cellSize}
          strokeLinecap="butt"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

/** The cycling junk code: pre-encoded frames (cached per length/size) stacked
 * as layers, with a `useFrameCallback` worklet flipping which one is opaque on
 * the UI thread. A `setInterval` + state version froze on its first frame —
 * this plays precisely while the JS thread is blocked composing the request,
 * which is exactly when JS timers stop firing. Purely cosmetic: the payloads
 * are throwaway noise and are never stored, copied, or exposed to AX. */
function QrJunkLayers({ expectedLength, size }: { expectedLength: number; size: number }) {
  const reducedMotion = useReducedMotion();
  const frames = useMemo(() => qrPlaceholderFrames(expectedLength, size), [expectedLength, size]);
  const frameCount = frames.length;

  const activeIndex = useSharedValue(0);
  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    const next = Math.floor(frame.timestamp / QR_PLACEHOLDER_FRAME_MS) % frameCount;
    if (next !== activeIndex.get()) activeIndex.set(next);
  }, false);
  useEffect(() => {
    // A perpetual tick stops uiautomator ever reaching idle, which blinds every
    // Android e2e AX dump — the same gate Skeleton/ElapsedSeconds carry.
    const active = !reducedMotion && !IS_ANDROID_E2E && frameCount > 1;
    if (!active) activeIndex.set(0);
    frameCallback.setActive(active);
    return () => frameCallback.setActive(false);
  }, [reducedMotion, frameCount, frameCallback, activeIndex]);

  return (
    <>
      {frames.map((frame, index) => (
        <PlaceholderFrameLayer
          key={index}
          frame={frame}
          index={index}
          activeIndex={activeIndex}
          size={size}
        />
      ))}
    </>
  );
}

/** The junk code wiping away top → bottom over a freshly rendered real QR
 * (`SCRAMBLE_DECODE_MS`, linear curve). Mount it over the live QR
 * when its value lands; it calls `onDone` once fully revealed so the caller
 * can unmount it. Transform-only: the clip is the outer box intersected with
 * a wrapper sliding down, whose content slides up by the same amount so the
 * junk pattern itself never moves. */
export function QrDecodeOverlay({
  length,
  size,
  onDone,
}: {
  length: number;
  size: number;
  onDone: () => void;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    progress.set(
      withTiming(1, { duration: SCRAMBLE_DECODE_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
    return () => cancelAnimation(progress);
  }, [progress, onDone]);
  const slideDown = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.get() * size }],
  }));
  const slideUp = useAnimatedStyle(() => ({
    transform: [{ translateY: -progress.get() * size }],
  }));
  const boxStyle = { width: size, height: size };
  return (
    <View pointerEvents="none" className="absolute inset-0 overflow-hidden">
      <Animated.View style={[boxStyle, slideDown]}>
        <Animated.View style={[boxStyle, JUNK_SURFACE, slideUp]}>
          <QrJunkLayers expectedLength={length} size={size} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// Plain object, not StyleSheet: it rides alongside the measured box size and the worklet style.
const JUNK_SURFACE = { backgroundColor: INVARIANT_WHITE } as const;

/** Reserve exactly the live QR card's geometry; shows the cycling junk QR (pure
 * black modules, never real data) with the currency logo in the middle when the
 * unit is known, otherwise the QR glyph, so loading feels alive instead of blank.
 *
 * `expectedLength` is the length of the payload being built: the junk is encoded
 * at that length so its module density matches the code that replaces it. */
export function PaymentQRCodePlaceholder({
  testID,
  unit,
  expectedLength = QR_PLACEHOLDER_DEFAULT_LENGTH,
}: {
  testID?: string;
  unit?: string;
  expectedLength?: number;
}) {
  const { width } = useWindowDimensions();
  const { qrSize } = qrCodeGeometry(width, PAYMENT_QR_PADDING);

  // Mirror the live QR's centred logo: same disc ratio, always a white disc.
  const logoSize = Math.max(20, Math.round(qrSize * 0.18));
  const circleSize = logoSize + 8;
  // Sizes derive from the measured QR square, so they stay as style objects.
  const layerStyle = { width: qrSize, height: qrSize, backgroundColor: INVARIANT_WHITE };
  const badgeStyle = {
    top: FRAME_PADDING + (qrSize - circleSize) / 2,
    left: FRAME_PADDING + (qrSize - circleSize) / 2,
    width: circleSize,
    height: circleSize,
    borderRadius: circleSize / 2,
    backgroundColor: INVARIANT_WHITE,
  };
  const isLocationUnit = unit?.startsWith('circle-flags') ?? false;
  return (
    <View
      testID={testID}
      className="items-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <QRCodeFrame>
        <View style={layerStyle}>
          <QrJunkLayers expectedLength={expectedLength} size={qrSize} />
        </View>
        <View
          pointerEvents="none"
          className="absolute items-center justify-center"
          style={badgeStyle}>
          {unit && isLocationUnit ? (
            <Icon name={unit} size={logoSize} />
          ) : unit ? (
            <CurrencyIcon
              key={unit}
              width={logoSize}
              currency={unit}
              colors={[INVARIANT_WHITE, INVARIANT_WHITE, INVARIANT_WHITE]}
              iconColor={INVARIANT_BLACK}
            />
          ) : (
            <Icon name="stash:qr-code" size={logoSize} color={INVARIANT_BLACK} />
          )}
        </View>
      </QRCodeFrame>
    </View>
  );
}
