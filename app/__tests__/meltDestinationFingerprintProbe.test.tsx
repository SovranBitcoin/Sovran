/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import { MeltDestinationFingerprintProbe } from '@/features/send/components/MeltDestinationFingerprintProbe';
import { paymentDestinationFingerprint } from '@/features/send/lib/paymentDestinationFingerprint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: Record<string, unknown>) => <view {...props} />,
}));

describe('MeltDestinationFingerprintProbe', () => {
  it('exposes only the one-way fingerprint as the AX value', async () => {
    const destination = 'lnbc40n1p-secret-payment-payload';
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<MeltDestinationFingerprintProbe destination={destination} />);
    });

    const fingerprint = paymentDestinationFingerprint(destination);
    const probe = renderer!.root.findByProps({
      testID: `melt-destination-fingerprint:${fingerprint}`,
    });
    expect(probe.props.accessibilityValue).toEqual({
      text: fingerprint,
    });
    expect(JSON.stringify(probe.props)).not.toContain(destination);
  });
});
