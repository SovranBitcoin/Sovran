import { useEffect, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import EQRCode from 'react-native-qrcode-svg';
import { useReducedMotion } from 'react-native-reanimated';
import Icon, { CurrencyIcon } from 'assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { View } from '@/shared/ui/primitives/View/View';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';

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

/** Junk payload whose QR version (module density) is close to the request that
 * will replace it: every frame is a different digit string of the same length,
 * so the placeholder reads as a live, shimmering code — never real data. */
const QR_PLACEHOLDER_LENGTH = 260;
const QR_PLACEHOLDER_FRAME_MS = 200;
/** Deterministic digit noise per frame: every frame reshuffles most modules so the
 * placeholder visibly animates (a repeated digit would only nudge a few cells). */
function qrPlaceholderPayload(frame: number, length = QR_PLACEHOLDER_LENGTH): string {
  let seed = (frame + 1) * 2654435761;
  let out = '';
  while (out.length < length) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += String(seed % 10);
  }
  return out;
}

/** Reserve exactly the live QR card's geometry; shows an animated junk QR (pure
 * black modules, never real data) with the currency logo in the middle when the
 * unit is known, otherwise the QR glyph, so loading feels alive instead of blank. */
export function PaymentQRCodePlaceholder({ testID, unit }: { testID?: string; unit?: string }) {
  const { width } = useWindowDimensions();
  const { qrSize } = qrCodeGeometry(width, PAYMENT_QR_PADDING);
  const reducedMotion = useReducedMotion();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setFrame((f) => f + 1), QR_PLACEHOLDER_FRAME_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);
  // Mirror the live QR's centred logo: same disc ratio, always a white disc.
  const logoSize = Math.max(20, Math.round(qrSize * 0.18));
  const circleSize = logoSize + 8;
  // Sizes derive from the measured QR square, so they stay as style objects.
  const layerStyle = { width: qrSize, height: qrSize };
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
          <EQRCode
            value={qrPlaceholderPayload(frame)}
            size={qrSize}
            ecl="L"
            color={INVARIANT_BLACK}
            backgroundColor={INVARIANT_WHITE}
          />
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
