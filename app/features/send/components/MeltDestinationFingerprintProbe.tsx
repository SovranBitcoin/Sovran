import { paymentDestinationFingerprint } from '@/features/send/lib/paymentDestinationFingerprint';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';

/**
 * Non-visual accessibility seam for proving that a Lightning destination
 * survives a mint change. Only a one-way fingerprint crosses the seam.
 */
export function MeltDestinationFingerprintProbe({ destination }: { destination: string }) {
  const fingerprint = paymentDestinationFingerprint(destination);
  return (
    <E2EAccessibilityProbe
      testID={`melt-destination-fingerprint:${fingerprint}`}
      accessibilityLabel="Payment destination fingerprint"
      value={fingerprint}
    />
  );
}
