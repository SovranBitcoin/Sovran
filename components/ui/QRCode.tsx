import React, { memo, useEffect, useState } from 'react';
import 'react-native-get-random-values';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { View } from 'components/ui/View';
import Icon, { CurrencyIcon } from 'assets/icons';
import { useWindowDimensions } from 'react-native';
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
  variant: _variant = 'primary',
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
  const isLocationUnit = unit.startsWith('circle-flags');
  const gradientColors = animate
    ? ([getPrimaryColor('700'), getPrimaryColor('700')] as const)
    : ([getShadeColor('200'), getShadeColor('300')] as const);

  return (
    <View className="flex-row items-center justify-center bg-transparent">
      {/* QR Code */}
      <LinearGradient colors={gradientColors} style={{ borderRadius: 16, padding: 16 }}>
        <EQRCode
          color={getPrimaryColor('0')}
          backgroundColor="transparent"
          value={qrData}
          size={width - 2 * padding}
        />
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
