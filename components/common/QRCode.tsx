import 'react-native-get-random-values';
import { useInterval } from 'usehooks-ts';
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { View } from 'components/common/Themed';
import { memo, useEffect, useState, useMemo } from 'react';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import { useQRCodeData } from 'react-native-qrcode-styled';
import { useWindowDimensions } from 'react-native';
import { greys, shades } from 'helper/colors';
import EQRCode from 'react-native-qrcode-svg';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

export const Circle = memo(({}) => {
  const theme = useSelector(memoizedGetTheme);
  return (
    <View
      style={{
        position: 'absolute',
        width: 100,
        height: 100,
        zIndex: 2,
        borderRadius: 9999,
        transform: [{ translateX: -50 }, { translateY: -50 }, { scale: 0.6 }],
        left: '50%',
        top: '50%',
        backgroundColor: greys(theme)[1800],
      }}></View>
  );
});

export const QRCode = memo(function QRCode({ padding = 0, animate, hasBackground, ...props }) {
  const theme = useSelector(memoizedGetTheme);
  const data = useQRCodeData(props.data, {});
  const w = useWindowDimensions().width;
  const width = Math.min(w, 600);

  const containerStyle = useMemo(
    () => ({
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
      {/* {animate ? ( */}
      <EQRCode
        enableLinearGradient
        linearGradient={[shades[100], shades[400]]}
        backgroundColor={greys(theme)[1800]}
        color={greys(theme)[1800]}
        value={props.data}
        size={width - 2 * padding}
        {...props}
      />
      {/* ) : (
        <QRCodeStyled
          pieceSize={(width - 2 * padding) / data.qrCodeSize}
          pieceScale={1.075}
          pieceLiquidRadius={1}
          pieceCornerType={"rounded"}
          isPiecesGlued={true}
          pieceBorderRadius={2}
          hasBackground={props.hasBackground}
          data={props.data}
          {...props}
        />
      )} */}
    </View>
  );
});

export const AnimatedQRCode = memo(function AnimatedQRCode({
  padding = 10,
  hasLogo = true,
  variant = 'primary',
  unit,
  address,
  animate = false,
  hasBackground = true,
}) {
  const theme = useSelector(memoizedGetTheme);
  const [index, setIndex] = useState(0);
  const [parts, setParts] = useState([]);
  const [fragmentLength, setFragmentLength] = useState(0);
  const colors = useMemo(
    () =>
      variant === 'primary'
        ? [shades[100], shades[200], shades[300], shades[400], shades[500]]
        : [greys(theme)[400], greys(theme)[100]],
    [variant, theme]
  );

  const containerStyle = useMemo(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    }),
    []
  );

  const logoStyle = useMemo(
    () => ({
      width: 72,
      height: 72,
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: [{ translateX: -36 }, { translateY: -36 }, { scale: 0.75 }],
      zIndex: 100,
      backgroundColor: 'transparent',
    }),
    []
  );

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
    } catch (error) {}
  }, [address, animate]);

  useInterval(
    () => {
      setIndex((prevIndex) => (prevIndex + 1) % fragmentLength);
    },
    animate // Slowed down to 250ms
  );

  const gradientOptions = useMemo(
    () => ({
      options: {
        colors: colors,
        start: [1, 0],
        end: [0, 1],
      },
    }),
    [colors]
  );

  const currentQRData = useMemo(() => {
    if (animate && parts.length > 0 && fragmentLength > 0) {
      return parts[index % fragmentLength];
    } else if (animate === false) {
      return address;
    }
    return null;
  }, [animate, parts, fragmentLength, index, address]);

  return (
    <View style={containerStyle}>
      {hasLogo && (
        <View style={logoStyle}>
          {unit.startsWith('location') ? (
            <FlagIcon country={unit.split('_')[1]} height={72} width={72} />
          ) : (
            <CurrencyIcon
              width="72"
              height="72"
              currency={unit}
              style={{
                borderRadius: 9999,
              }}
            />
          )}
        </View>
      )}
      {hasLogo && <Circle />}
      {currentQRData && (
        <QRCode
          animate={animate}
          hasBackground={hasBackground}
          data={currentQRData}
          padding={padding}
          gradient={gradientOptions}
          preserveAspectRatio="none"
        />
      )}
    </View>
  );
});
