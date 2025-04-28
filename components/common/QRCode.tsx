import 'react-native-get-random-values';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { View } from 'components/common/Themed';
import { memo, useEffect, useState, useMemo } from 'react';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import { useWindowDimensions, StyleSheet, ViewStyle } from 'react-native';
import { greys, shades } from 'helper/colors';
import EQRCode from 'react-native-qrcode-svg';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

/**
 * Circle background for the QR code center logo
 */
export const Circle = memo(() => {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View
      className="absolute z-10"
      style={{
        width: 100,
        height: 100,
        borderRadius: 9999,
        transform: [{ translateX: -50 }, { translateY: -50 }, { scale: 0.6 }],
        left: '50%' as any,
        top: '50%' as any,
        backgroundColor: greys(theme)[1800],
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
}: QRCodeProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const { width: w } = useWindowDimensions();
  const width = Math.min(w, 600);

  const containerStyle = useMemo(
    (): ViewStyle => ({
      ...(hasBackground
        ? {
            backgroundColor: greys(theme)[1800],
            padding: 16,
            borderRadius: 16,
          }
        : {}),
    }),
    [hasBackground, theme]
  );

  return (
    <View style={containerStyle}>
      <EQRCode
        enableLinearGradient
        linearGradient={[shades[100], shades[400]]}
        backgroundColor={greys(theme)[1800]}
        color={greys(theme)[1800]}
        value={props.data}
        size={width - 2 * padding}
        {...props}
      />
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

type UnitType = string;

/**
 * Animated QR code with currency/location logo
 */
export const AnimatedQRCode = memo(function AnimatedQRCode({
  padding = 10,
  hasLogo = true,
  variant = 'primary',
  unit,
  address,
  animate = false,
  hasBackground = true,
}: AnimatedQRCodeProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const [index, setIndex] = useState<number>(0);
  const [parts, setParts] = useState<string[]>([]);
  const [fragmentLength, setFragmentLength] = useState<number>(0);

  const colors = useMemo(
    () =>
      variant === 'primary'
        ? [shades[100], shades[200], shades[300], shades[400], shades[500]]
        : [greys(theme)[400], greys(theme)[100]],
    [variant, theme]
  );

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

  const renderLogo = (): JSX.Element | null => {
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
