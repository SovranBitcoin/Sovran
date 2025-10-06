import React, { memo, useEffect, useState, useMemo } from 'react';
import 'react-native-get-random-values';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { View } from 'components/ui/View';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import { useWindowDimensions, StyleSheet, ViewStyle } from 'react-native';
import EQRCode from 'react-native-qrcode-svg';
import { useTheme } from 'providers/ThemeProvider';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Circle background for the QR code center logo
 */
export const Circle = memo(() => {
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

/**
 * QR code interface properties
 */
interface QRCodeProps {
  data: string;
  padding?: number;
  animate?: boolean;
  hasBackground?: boolean;
  gradient?: {
    options: {
      colors: string[];
      start: [number, number];
      end: [number, number];
    };
  };
  preserveAspectRatio?: string;
}

/**
 * Basic QR code component
 */
export const QRCode = memo(function QRCode({
  padding = 0,
  animate = false,
  hasBackground = false,
  ...props
}: QRCodeProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const { width: w } = useWindowDimensions();
  const width = Math.min(w, 600);

  const containerStyle = useMemo(
    (): ViewStyle => ({
      ...(hasBackground ? {} : {}),
    }),
    [hasBackground]
  );

  return (
    <View style={containerStyle}>
      <LinearGradient
        colors={
          !animate
            ? [getShadeColor('200'), getShadeColor('300')]
            : [getPrimaryColor('700'), getPrimaryColor('700')]
        }
        className={hasBackground ? 'bg-primary-950' : ''}
        style={{
          ...(hasBackground
            ? {
                padding: 16,
                borderRadius: 16,
              }
            : {}),
        }}>
        <EQRCode
          color={getPrimaryColor('0')}
          backgroundColor={'transparent'}
          value={props.data}
          size={width - 2 * padding}
          {...props}
        />
      </LinearGradient>
    </View>
  );
});

/**
 * AnimatedQRCode props interface
 */
interface AnimatedQRCodeProps {
  padding?: number;
  hasLogo?: boolean;
  variant?: 'primary' | 'secondary';
  unit: string;
  address: string;
  animate?: boolean;
  hasBackground?: boolean;
}

/**
 * Animated QR code with currency/location logo
 */
export const AnimatedQRCode = memo(function AnimatedQRCode({
  padding = 10,
  hasLogo = true,
  unit,
  address,
  animate = false,
  hasBackground = true,
}: AnimatedQRCodeProps) {
  const [index, setIndex] = useState<number>(0);
  const [parts, setParts] = useState<string[]>([]);
  const [fragmentLength, setFragmentLength] = useState<number>(0);

  const styles = useMemo(() => createStyles(), []);

  useEffect(() => {
    if (!animate || !address) return;

    try {
      const messageBuffer = Buffer.from(address);
      const ur = UR.fromBuffer(messageBuffer);
      const maxFragmentLength = 300;
      const firstSeqNum = 0;
      const encoder = new UREncoder(ur, maxFragmentLength, firstSeqNum);
      setParts(encoder.encodeWhole());
      setFragmentLength(encoder.fragmentsLength);
    } catch (error) {
      console.error('Error encoding address:', error);
    }
  }, [address, animate]);

  useInterval(
    () => {
      setIndex((prevIndex) => (prevIndex + 1) % fragmentLength);
    },
    animate && fragmentLength > 0 ? 250 : null
  );

  const currentQRData = useMemo((): string | null => {
    if (animate && parts.length > 0 && fragmentLength > 0) {
      return parts[index % fragmentLength];
    } else if (!animate && address) {
      return address;
    }
    return null;
  }, [animate, parts, fragmentLength, index, address]);

  const renderLogo = () => {
    if (!hasLogo) return null;

    const isLocationUnit = unit.startsWith('location');

    return (
      <View style={styles.logoContainer}>
        {isLocationUnit ? (
          <FlagIcon country={unit.split('_')[1]} height={72} width={72} />
        ) : (
          <CurrencyIcon width={72} currency={unit} />
        )}
      </View>
    );
  };

  return (
    <View className="flex-row items-center justify-center bg-transparent">
      {hasLogo && renderLogo()}
      {hasLogo && <Circle />}
      {currentQRData && (
        <QRCode
          animate={animate}
          hasBackground={hasBackground}
          data={currentQRData}
          padding={padding}
          preserveAspectRatio="none"
        />
      )}
    </View>
  );
});

const createStyles = () =>
  StyleSheet.create({
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
  });
