import React, { memo, useEffect, useState } from 'react';
import 'react-native-get-random-values';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { View } from '@/shared/ui/primitives/View/View';
import Icon, { CurrencyIcon } from 'assets/icons';
import { useWindowDimensions, ActivityIndicator } from 'react-native';
import EQRCode from 'react-native-qrcode-svg';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';

// Maximum characters that can fit in a QR code (conservative limit for binary/alphanumeric)
const MAX_QR_DATA_LENGTH = 2000;

/**
 * Circle background for the QR code center logo
 */
const Circle = memo(() => {
  const foreground = useThemeColor('foreground');
  return (
    <View
      className="absolute z-10"
      style={{
        width: 100,
        height: 100,
        borderRadius: 9999,
        transform: [{ translateX: -50 }, { translateY: -50 }, { scale: 0.63 }],
        left: '50%' as any,
        top: '50%' as any,
        backgroundColor: foreground,
      }}
    />
  );
});

Circle.displayName = 'Circle';

interface AnimatedQRCodeProps {
  padding?: number;
  unit: string;
  address: string;
  animate?: boolean;
  variant?: 'primary' | 'secondary';
}

/**
 * Animated QR code with currency/location logo
 *
 * When data is too large for a single QR code, it will automatically
 * use UR encoding to split the data into multiple animated frames.
 */
export const AnimatedQRCode = memo(function AnimatedQRCode({
  padding = 10,
  unit,
  address,
  animate: animateProp = false,
  variant: _variant = 'primary',
}: AnimatedQRCodeProps) {
  const [foreground, surfaceTertiary, shade200, shade300] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'shade-200',
    'shade-300',
  ] as const);
  const { width: screenWidth } = useWindowDimensions();

  const [index, setIndex] = useState(0);
  const [parts, setParts] = useState<string[]>([]);
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodingError, setEncodingError] = useState<string | null>(null);

  // Determine if we need to animate based on data size or explicit prop
  // If data is too large for a single QR code, force animation
  const needsAnimation = animateProp || (address && address.length > MAX_QR_DATA_LENGTH);

  // Encode address for animated QR code
  useEffect(() => {
    if (!address) return;

    // Reset state when address changes
    setParts([]);
    setIndex(0);
    setEncodingError(null);

    // If we don't need animation and data fits in a single QR, skip encoding
    if (!needsAnimation) return;

    setIsEncoding(true);

    try {
      const messageBuffer = Buffer.from(address);
      const ur = UR.fromBuffer(messageBuffer);
      // Use smaller fragment size for more reliable QR codes
      const encoder = new UREncoder(ur, 200, 0);
      const encodedParts = encoder.encodeWhole();

      if (encodedParts.length === 0) {
        throw new Error('UR encoding produced no parts');
      }

      setParts(encodedParts);
      setEncodingError(null);
    } catch (error) {
      console.error('Error encoding address:', error);
      setEncodingError(error instanceof Error ? error.message : 'Failed to encode QR data');
      // Don't fall back to raw address if it's too large - it will just error again
      setParts([]);
    } finally {
      setIsEncoding(false);
    }
  }, [address, needsAnimation]);

  // Cycle through QR code parts
  useInterval(
    () => setIndex((prev) => (prev + 1) % parts.length),
    needsAnimation && parts.length > 1 ? 250 : null
  );

  // Determine what data to show
  // - If animation is needed and parts are ready, use animated parts
  // - If animation is not needed and data fits, use raw address
  // - Otherwise, show loading or error state
  const qrData = needsAnimation && parts.length > 0 ? parts[index] : address;
  const showLoading = needsAnimation && isEncoding;
  const showError = needsAnimation && encodingError && parts.length === 0;
  const canRenderQR = !showLoading && !showError && qrData && qrData.length <= MAX_QR_DATA_LENGTH;

  const width = Math.min(screenWidth, 600);
  const isLocationUnit = unit.startsWith('circle-flags');
  const gradientColors = needsAnimation
    ? ([surfaceTertiary, surfaceTertiary] as const)
    : ([shade200, shade300] as const);
  const qrSize = width - 2 * padding;

  return (
    <View className="flex-row items-center justify-center bg-transparent">
      {/* QR Code Container */}
      <LinearGradient colors={gradientColors} style={{ borderRadius: 16, padding: 16 }}>
        {showLoading ? (
          // Loading state while encoding large data
          <View
            style={{
              width: qrSize,
              height: qrSize,
              justifyContent: 'center',
              alignItems: 'center',
            }}>
            <ActivityIndicator size="large" color={foreground} />
          </View>
        ) : showError ? (
          // Error state if encoding failed
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
          // Normal QR code render
          <EQRCode color={foreground} backgroundColor="transparent" value={qrData} size={qrSize} />
        ) : (
          // Fallback: data too large and couldn't be encoded
          <View
            style={{
              width: qrSize,
              height: qrSize,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 20,
            }}>
            <ActivityIndicator size="large" color={foreground} />
          </View>
        )}
      </LinearGradient>

      {/* Circle background for the logo */}
      <Circle />

      {/* Logo */}
      <View
        className="absolute left-1/2 top-1/2 z-[100] -translate-x-9 -translate-y-9 scale-75 bg-transparent"
        style={{
          transform: [{ translateX: -36 }, { translateY: -36 }, { scale: 0.75 }],
        }}>
        {isLocationUnit ? (
          <Icon name={unit} size={72} />
        ) : (
          <CurrencyIcon width={72} currency={unit} />
        )}
      </View>
    </View>
  );
});
