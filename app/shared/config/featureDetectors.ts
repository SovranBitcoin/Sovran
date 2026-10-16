import { defaultDetectors, type Detectors } from 'wallet';
import { hasFeature, type Feature } from '@/shared/config/features';

type DetectorName = keyof Detectors;

/** The module whose input each detector recognises (ADR 0021). */
const DETECTOR_FEATURE: Partial<Record<DetectorName, Feature>> = {
  isValidEcashToken: 'ecash',
  isPaymentRequest: 'paymentRequests',
  isLightningInvoice: 'lightning',
  isBolt12Offer: 'bolt12',
  isLightningAddress: 'lightning',
  isLnurlp: 'lightning',
  parseNpub: 'nostr',
};

/**
 * `defaultDetectors` with the build's disabled modules blinded: input they
 * would have matched parses as unknown, so scan and paste report it as
 * unsupported instead of starting a flow the build cannot finish.
 */
export function featureDetectors(enabled: (feature: Feature) => boolean = hasFeature): Detectors {
  const detectors = { ...defaultDetectors };
  for (const [name, feature] of Object.entries(DETECTOR_FEATURE) as [DetectorName, Feature][]) {
    if (enabled(feature)) continue;
    const blind = name.startsWith('is') ? () => false : () => null;
    Object.assign(detectors, { [name]: blind });
  }
  return detectors;
}

/** The build's detectors, computed once. */
export const buildDetectors: Detectors = featureDetectors();
