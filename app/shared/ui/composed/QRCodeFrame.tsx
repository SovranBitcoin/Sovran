import { useEffect, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import EQRCode from 'react-native-qrcode-svg';
import { useReducedMotion } from 'react-native-reanimated';
import Icon from 'assets/icons';
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
export const QR_PLACEHOLDER_LENGTH = 260;
export const QR_PLACEHOLDER_FRAME_MS = 320;
export function qrPlaceholderPayload(frame: number, length = QR_PLACEHOLDER_LENGTH): string {
  const digit = String((frame % 9) + 1);
  return `${frame}`.padEnd(length, digit);
}

/** Reserve exactly the live QR card's geometry; shows an animated junk QR with
 * the QR glyph in the middle so loading feels alive instead of blank. */
export function PaymentQRCodePlaceholder({ testID }: { testID?: string }) {
  const { width } = useWindowDimensions();
  const { qrSize } = qrCodeGeometry(width, PAYMENT_QR_PADDING);
  const reducedMotion = useReducedMotion();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setFrame((f) => f + 1), QR_PLACEHOLDER_FRAME_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);
  const badge = Math.round(qrSize * 0.22);
  // Sizes derive from the measured QR square, so they stay as style objects.
  const layerStyle = { width: qrSize, height: qrSize };
  const badgeStyle = {
    top: FRAME_PADDING + (qrSize - badge) / 2,
    left: FRAME_PADDING + (qrSize - badge) / 2,
    width: badge,
    height: badge,
    borderRadius: badge / 4,
    backgroundColor: INVARIANT_WHITE,
  };
  return (
    <View
      testID={testID}
      className="items-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <QRCodeFrame>
        <View className="opacity-35" style={layerStyle}>
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
          <Icon name="stash:qr-code" size={Math.round(badge * 0.62)} color={INVARIANT_BLACK} />
        </View>
      </QRCodeFrame>
    </View>
  );
}
