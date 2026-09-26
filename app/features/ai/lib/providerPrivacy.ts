import type { ProviderModelSummary } from '@/shared/lib/routstr/providers';

/**
 * Who can read what the user is about to type, said at the top of the provider
 * page in words rather than left to a count in a tile.
 *
 * Four answers, and the difference between them is the reason the page exists.
 * A provider that serves no sealed models can read everything; one that serves
 * some can read everything sent to the rest, which is the easiest state to
 * misread off a green shield; one whose whole catalog is sealed genuinely
 * cannot, and deserves to be told apart from the other two. A catalog that
 * never answered supports none of those claims, so it makes none — the loudest
 * wrong answer here would be a reassuring one.
 *
 * ## Every variant is the same size
 *
 * The notice holds its slot while the catalog is out, and a skeleton can only
 * hold a slot confidently when it knows how tall the content will be. So the
 * four variants are written to the same shape — a one-line title and a
 * two-line body — and `PROVIDER_PRIVACY_SKELETON` is one of them verbatim.
 * `aiProviderPrivacyCopy.test.ts` pins the lengths to a band around it, so a
 * rewrite that grows one variant by a line fails a test instead of shoving the
 * stats grid down under the reader's thumb.
 */

export type ProviderPrivacyStatus = 'info' | 'warning' | 'success';

export interface ProviderPrivacyNotice {
  status: ProviderPrivacyStatus;
  title: string;
  body: string;
}

/**
 * The placeholder the notice reserves its slot with. It is the plaintext
 * warning, the commonest verdict on the network, so the reserved height is
 * the height most pages will actually need.
 */
export const PROVIDER_PRIVACY_SKELETON: Readonly<Pick<ProviderPrivacyNotice, 'title' | 'body'>> = {
  title: 'This provider can read your messages',
  body: 'None of its models run in an enclave. Everything you send is visible to whoever runs this node.',
};

export function providerPrivacyNotice(
  catalog: Pick<ProviderModelSummary, 'count' | 'encrypted'> | null
): ProviderPrivacyNotice {
  if (!catalog || catalog.count === 0) {
    return {
      status: 'info',
      title: 'Privacy not known',
      body: 'This provider did not list its models, so whether any of them run in an enclave could not be checked.',
    };
  }
  if (catalog.encrypted === 0) {
    return {
      status: 'warning',
      title: PROVIDER_PRIVACY_SKELETON.title,
      body: PROVIDER_PRIVACY_SKELETON.body,
    };
  }
  if (catalog.encrypted < catalog.count) {
    return {
      status: 'warning',
      title: 'This provider can read some messages',
      body: `Only ${catalog.encrypted.toLocaleString()} of its ${catalog.count.toLocaleString()} models run in an enclave. Anything sent to the rest is visible to whoever runs this node.`,
    };
  }
  // Green, and stated rather than implied. The absence of a warning is not
  // the same claim as "it cannot read them" — and this is the one provider
  // shape where the second is true.
  return {
    status: 'success',
    title: 'This provider cannot read your messages',
    body: 'Every model it serves runs in an enclave, so requests are sealed end to end and never readable here.',
  };
}
