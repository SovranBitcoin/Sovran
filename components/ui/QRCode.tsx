import React, { memo, useEffect, useState } from 'react';
import 'react-native-get-random-values';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { View } from 'components/ui/View';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import { useWindowDimensions, StyleSheet } from 'react-native';
import EQRCode from 'react-native-qrcode-svg';
import { useTheme } from 'providers/ThemeProvider';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Circle background for the QR code center logo
 */
const Circle = memo(() => {
  const { getPrimaryColor } = useTheme();
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
        backgroundColor: getPrimaryColor('0'),
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
 */
export const AnimatedQRCode = memo(function AnimatedQRCode({
  padding = 10,
  unit,
  address,
  animate = false,
  variant = 'primary',
}: AnimatedQRCodeProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const [index, setIndex] = useState(0);
  const [parts, setParts] = useState<string[]>([]);

  // Encode address for animated QR code
  useEffect(() => {
    if (!animate || !address) return;

    try {
      const messageBuffer = Buffer.from(address);
      const ur = UR.fromBuffer(messageBuffer);
      const encoder = new UREncoder(ur, 300, 0);
      setParts(encoder.encodeWhole());
    } catch (error) {
      console.error('Error encoding address:', error);
    }
  }, [address, animate]);

  // Cycle through QR code parts
  useInterval(
    () => setIndex((prev) => (prev + 1) % parts.length),
    animate && parts.length > 0 ? 250 : null
  );

  const qrData = animate && parts.length > 0 ? parts[index] : address;
  const width = Math.min(screenWidth, 600);
  const isLocationUnit = unit.startsWith('location');
  const gradientColors = animate
    ? [getPrimaryColor('700'), getPrimaryColor('700')]
    : [getShadeColor('200'), getShadeColor('300')];

  return (
    <View className="flex-row items-center justify-center bg-transparent">
      {/* Logo */}
      <View className="z-100 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-75">
        {isLocationUnit ? (
          <FlagIcon country={unit.split('_')[1]} height={72} width={72} />
        ) : (
          <CurrencyIcon width={72} currency={unit} />
        )}
      </View>

      <Circle />

      {/* QR Code */}
      <LinearGradient colors={gradientColors} style={styles.gradient}>
        <EQRCode
          color={getPrimaryColor('0')}
          backgroundColor="transparent"
          value={qrData}
          size={width - 2 * padding}
          preserveAspectRatio="none"
        />
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  logoContainer: {
    width: 72,
    height: 72,
    position: 'absolute',
    top: '50%' as any,
    left: '50%' as any,
    transform: [{ translateX: -36 }, { translateY: -36 }, { scale: 0.75 }],
    zIndex: 100,
    backgroundColor: 'transparent',
  },
  gradient: {
    padding: 16,
    borderRadius: 16,
  },
});
