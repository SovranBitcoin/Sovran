/** Reserve the live QR and copy-card frames while the receive rail loads. */

import { PaymentQRCodePlaceholder } from '@/shared/ui/composed/QRCodeFrame';
import { CopyRequestCard } from '@/shared/ui/composed/CopyRequestCard';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';

export function ReceiveRailPlaceholder({
  sectionTitle,
  testID,
  qrTestID,
}: {
  sectionTitle: string;
  testID?: string;
  qrTestID?: string;
}) {
  const muted = useThemeColor('muted');

  return (
    <View testID={testID}>
      <PaymentQRCodePlaceholder testID={qrTestID} />
      <CopyRequestCard
        title={sectionTitle}
        icon="stash:qr-code"
        display=" "
        muted={muted}
        loading
      />
    </View>
  );
}
