/** Reserve the live QR and copy-card frames while the receive rail loads:
 * a junk QR at the density of the request being built, and a copy row whose
 * value scrambles until the real one decodes in. */

import { PaymentQRCodePlaceholder } from '@/shared/ui/composed/QRCodeFrame';
import { CopyRequestCard } from '@/shared/ui/composed/CopyRequestCard';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';

export function ReceiveRailPlaceholder({
  sectionTitle,
  testID,
  qrTestID,
  unit,
  expectedLength,
}: {
  sectionTitle: string;
  testID?: string;
  qrTestID?: string;
  /** Draws the currency logo in the placeholder's centre when known. */
  unit?: string;
  /** Length of the payload being built — sets the junk QR's module density
   *  (see `expectedQrPayloadLength`). */
  expectedLength?: number;
}) {
  const muted = useThemeColor('muted');

  return (
    <View testID={testID}>
      <PaymentQRCodePlaceholder testID={qrTestID} unit={unit} expectedLength={expectedLength} />
      <CopyRequestCard title={sectionTitle} icon="stash:qr-code" parts={[]} muted={muted} loading />
    </View>
  );
}
