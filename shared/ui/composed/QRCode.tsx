import React, { memo, useEffect, useRef, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { PressableFeedback } from 'heroui-native';
import { log, Log } from '@/shared/lib/logger';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon, { CurrencyIcon } from 'assets/icons';
import { useWindowDimensions, ActivityIndicator } from 'react-native';
import EQRCode from 'react-native-qrcode-svg';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';

export { SPEED_PRESETS, DENSITY_PRESETS, DEFAULT_SPEED_INDEX, DEFAULT_DENSITY_INDEX };

// Maximum characters that can fit in a single QR code (conservative limit for binary/alphanumeric)
const MAX_QR_DATA_LENGTH = 2000;

// UR encoding parameters — aligned with the cashu ecosystem:
// eNuts: fragment=200, interval=250ms, animate≥150chars
// minibits: fragment=150, interval=250ms
// cashu.me: fragment=150 (default), interval=150/250/500ms (adjustable)
const ANIMATE_THRESHOLD = 500; // chars — animate tokens above this length (multi-proof tokens)

// Speed presets — cycle through with tap (cashu.me: 150/250/500)
const SPEED_PRESETS = [
  { label: 'Fast', intervalMs: 100 },
  { label: 'Medium', intervalMs: 200 },
  { label: 'Slow', intervalMs: 400 },
] as const;
const DEFAULT_SPEED_INDEX = 1; // Medium

// Density presets — controls bytes per UR fragment (cashu.me: S=50, M=100, L=150)
// Fewer bytes = simpler QR per frame (easier to scan), more frames total.
const DENSITY_PRESETS = [
  { label: 'Light', fragmentSize: 50 },
  { label: 'Medium', fragmentSize: 100 },
  { label: 'Heavy', fragmentSize: 150 },
] as const;
const DEFAULT_DENSITY_INDEX = 2; // L (150 bytes, ecosystem default)

const LOGO_SIZE = 54;
const CIRCLE_SIZE = LOGO_SIZE + 8;

interface AnimatedQRCodeProps {
  padding?: number;
  unit: string;
  address: string;
  animate?: boolean;
  variant?: 'primary' | 'secondary';
  /** Override frame interval (ms). Controlled externally by QRSpeedControls. */
  intervalMs?: number;
  /** Override UR fragment size (bytes). Controlled externally by QRSpeedControls. */
  fragmentSize?: number;
  /**
   * Override the outer width of the QR block (gradient included). When
   * omitted, the component fills the screen width (classic receive-screen
   * behaviour). When provided, the centered currency logo is scaled
   * proportionally so it never occupies more than ~18% of the QR area —
   * keeping scans reliable at default (M) error correction.
   */
  size?: number;
}

/**
 * Animated QR code with currency/location logo
 *
 * When data is too large for a single QR code, it will automatically
 * use UR encoding to split the data into multiple animated frames.
 * Animated QRs show a speed toggle button (Fast / Medium / Slow).
 */
export const AnimatedQRCode = memo(function AnimatedQRCode({
  padding = 10,
  unit,
  address,
  animate: animateProp = false,
  variant: _variant = 'primary',
  intervalMs,
  fragmentSize,
  size,
}: AnimatedQRCodeProps) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const { width: screenWidth } = useWindowDimensions();

  const [index, setIndex] = useState(0);
  const [parts, setParts] = useState<string[]>([]);
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodingError, setEncodingError] = useState<string | null>(null);

  const activeIntervalMs = intervalMs ?? SPEED_PRESETS[DEFAULT_SPEED_INDEX].intervalMs;
  const activeFragmentSize = fragmentSize ?? DENSITY_PRESETS[DEFAULT_DENSITY_INDEX].fragmentSize;

  // Animate when:
  // 1. Data exceeds the QR capacity (must split), OR
  // 2. Caller requests it AND data is large enough to benefit (multi-proof tokens)
  // Short data (addresses, invoices) is always static — faster to scan.
  const needsAnimation =
    (address != null && address.length > MAX_QR_DATA_LENGTH) ||
    (animateProp && address != null && address.length >= ANIMATE_THRESHOLD);

  const encodeStartRef = useRef(0);

  // Encode address for animated QR code
  useEffect(() => {
    if (!address) {
      log.debug('ui.qrcode.no_address');
      return;
    }

    // Reset state when address changes
    setParts([]);
    setIndex(0);
    setEncodingError(null);

    log.info('ui.qrcode.address_set', {
      length: address.length,
      needsAnimation,
      isUR: address.toLowerCase().startsWith('ur:'),
    });

    // If we don't need animation and data fits in a single QR, skip encoding
    if (!needsAnimation) {
      log.debug('ui.qrcode.static_mode', { dataLength: address.length });
      return;
    }

    setIsEncoding(true);
    encodeStartRef.current = performance.now();

    try {
      const messageBuffer = Buffer.from(address);
      const ur = UR.fromBuffer(messageBuffer);
      const encoder = new UREncoder(ur, activeFragmentSize, 0);
      const encodedParts = encoder.encodeWhole();

      if (encodedParts.length === 0) {
        throw new Error('UR encoding produced no parts');
      }

      const duration = Math.round(performance.now() - encodeStartRef.current);
      log.info('ui.qrcode.ur_encoded', {
        inputLength: address.length,
        partCount: encodedParts.length,
        fragmentSize: activeFragmentSize,
        intervalMs: activeIntervalMs,
        firstPartLength: encodedParts[0].length,
        duration_ms: duration,
      });

      setParts(encodedParts);
      setEncodingError(null);
    } catch (error) {
      log.error('ui.qrcode.encode_failed', {
        error,
        addressLength: address.length,
        needsAnimation,
      });
      setEncodingError(error instanceof Error ? error.message : 'Failed to encode QR data');
      setParts([]);
    } finally {
      setIsEncoding(false);
    }
  }, [address, needsAnimation, activeFragmentSize]);

  // Cycle through QR code parts at the selected speed
  useInterval(
    () => setIndex((prev) => (prev + 1) % parts.length),
    needsAnimation && parts.length > 1 ? activeIntervalMs : null
  );

  // Determine what data to show
  const qrData = needsAnimation && parts.length > 0 ? parts[index] : address;
  const showLoading = needsAnimation && (isEncoding || (parts.length === 0 && !encodingError));
  const showError = needsAnimation && encodingError && parts.length === 0;
  const canRenderQR = !showLoading && !showError && qrData && qrData.length <= MAX_QR_DATA_LENGTH;
  const isAnimating = needsAnimation && parts.length > 1;

  const width = size ?? Math.min(screenWidth, 600);
  const isLocationUnit = unit.startsWith('circle-flags');
  const gradientColors = [foreground, foreground] as const;
  const qrSize = width - 2 * padding;
  // When the caller sizes the block explicitly (e.g. a card deck), scale
  // the centered logo with it so the logo-to-QR ratio stays scan-safe
  // (~18% of the QR area). Default (no `size`) preserves the original
  // 54 px receive-screen logo.
  const logoSize = size != null ? Math.max(20, Math.round(qrSize * 0.18)) : LOGO_SIZE;
  const circleSize = logoSize + 8;

  // Log render state for debugging
  const renderState = showLoading
    ? 'loading'
    : showError
      ? 'error'
      : canRenderQR
        ? 'rendered'
        : 'fallback';
  const prevRenderRef = useRef('');
  useEffect(() => {
    if (renderState !== prevRenderRef.current) {
      prevRenderRef.current = renderState;
      log.debug('ui.qrcode.render', {
        state: renderState,
        animated: needsAnimation,
        partCount: parts.length,
        frameIndex: needsAnimation ? index : undefined,
        dataLength: qrData?.length ?? 0,
        unit,
      });
    }
  });

  return (
    <Log name="AnimatedQRCode">
      <View style={{ alignItems: 'center' }}>
        {/* QR + centered logo overlay */}
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <LinearGradient colors={gradientColors} style={{ borderRadius: 16, padding: 16 }}>
            {showLoading ? (
              <View
                style={{
                  width: qrSize,
                  height: qrSize,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                <ActivityIndicator size="large" color={surfaceTertiary} />
              </View>
            ) : showError ? (
              <View
                style={{
                  width: qrSize,
                  height: qrSize,
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: 20,
                }}>
                <Icon name="ri:error-warning-line" size={48} color={opacity(foreground, 0.5)} />
              </View>
            ) : canRenderQR ? (
              <EQRCode
                color={surfaceTertiary}
                backgroundColor="transparent"
                value={qrData}
                size={qrSize}
              />
            ) : (
              <View
                style={{
                  width: qrSize,
                  height: qrSize,
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: 20,
                }}>
                <ActivityIndicator size="large" color={surfaceTertiary} />
              </View>
            )}
          </LinearGradient>

          {/* Centered logo — absolutely positioned from the container's center */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              alignItems: 'center',
              justifyContent: 'center',
              width: circleSize,
              height: circleSize,
              borderRadius: circleSize / 2,
              backgroundColor: foreground,
            }}>
            {isLocationUnit ? (
              <Icon name={unit} size={logoSize} />
            ) : (
              <CurrencyIcon
                width={logoSize}
                currency={unit}
                colors={[foreground, foreground, foreground]}
                iconColor={surfaceTertiary}
              />
            )}
          </View>
        </View>
      </View>
    </Log>
  );
});

// ─── Speed gauge icon with rotatable pointer ───────────────────────────────

const POINTER_ROTATION = [0, -45, -90] as const; // Fast, Medium, Slow

function SpeedGaugeIcon({
  size,
  color,
  speedIndex,
}: {
  size: number;
  color: string;
  speedIndex: number;
}) {
  const rotation = useSharedValue(POINTER_ROTATION[speedIndex] ?? 0);

  useEffect(() => {
    rotation.set(withSpring(POINTER_ROTATION[speedIndex] ?? 0, { damping: 12, stiffness: 120 }));
  }, [speedIndex]);

  const pointerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {/* Pointer layer — rotates around center */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, pointerStyle]}>
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Path
            fill="none"
            stroke={color}
            strokeLinejoin="round"
            strokeWidth={4}
            d="M30.297 18.779s-3.23 9.102-4.764 10.691a4 4 0 0 1-5.754-5.557c1.534-1.59 10.518-5.134 10.518-5.134Z"
          />
        </Svg>
      </Animated.View>
      {/* Static gauge arc + tick marks */}
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path
          fill="none"
          stroke={color}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeWidth={4}
          d="M38.85 38.85A20.94 20.94 0 0 0 45 24c0-11.598-9.402-21-21-21S3 12.402 3 24c0 5.799 2.35 11.049 6.15 14.85M24 4v4m14.845 3.142l-3.108 2.517m6.785 13.574l-3.897-.9m-33.148.9l3.898-.9m-.22-15.191l3.108 2.517"
        />
      </Svg>
    </View>
  );
}

// ─── Speed / Density controls (rendered outside AnimatedQRCode) ─────────────

interface QRSpeedControlsProps {
  speedIndex: number;
  densityIndex: number;
  onCycleSpeed: () => void;
  onCycleDensity: () => void;
}

export const QRSpeedControls = memo(function QRSpeedControls({
  speedIndex,
  densityIndex,
  onCycleSpeed,
  onCycleDensity,
}: QRSpeedControlsProps) {
  const foreground = useThemeColor('foreground');

  return (
    <GradientCard style={{ marginHorizontal: 16 }}>
      <HStack style={{ minHeight: 44 }}>
        <PressableFeedback
          testID="qr-speed-control"
          animation={false}
          onPress={onCycleSpeed}
          style={{ flex: 1 }}>
          <PressableFeedback.Scale>
            <HStack align="center" justify="center" gap={6} style={{ paddingVertical: 12 }}>
              <SpeedGaugeIcon size={16} color={opacity(foreground, 0.5)} speedIndex={speedIndex} />
              <Text size={13} color={opacity(foreground, 0.5)}>
                {SPEED_PRESETS[speedIndex].label}
              </Text>
            </HStack>
          </PressableFeedback.Scale>
          <PressableFeedback.Ripple />
        </PressableFeedback>

        <View
          style={{ width: 1, backgroundColor: opacity(foreground, 0.08), marginVertical: 10 }}
        />

        <PressableFeedback
          testID="qr-density-control"
          animation={false}
          onPress={onCycleDensity}
          style={{ flex: 1 }}>
          <PressableFeedback.Scale>
            <HStack align="center" justify="center" gap={6} style={{ paddingVertical: 12 }}>
              <Icon name="stash:qr-code" size={16} color={opacity(foreground, 0.5)} />
              <Text size={13} color={opacity(foreground, 0.5)}>
                {DENSITY_PRESETS[densityIndex].label}
              </Text>
            </HStack>
          </PressableFeedback.Scale>
          <PressableFeedback.Ripple />
        </PressableFeedback>
      </HStack>
    </GradientCard>
  );
});
