import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { View } from '@/shared/ui/primitives/View/View';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';

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

/** Reserve exactly the live QR card's geometry without encoding a payload. */
export function PaymentQRCodePlaceholder({ testID }: { testID?: string }) {
  const { width } = useWindowDimensions();
  const { qrSize } = qrCodeGeometry(width, PAYMENT_QR_PADDING);
  const placeholderStyle = { width: qrSize, height: qrSize };
  return (
    <View
      testID={testID}
      className="items-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <QRCodeFrame>
        <View style={placeholderStyle} />
      </QRCodeFrame>
    </View>
  );
}
