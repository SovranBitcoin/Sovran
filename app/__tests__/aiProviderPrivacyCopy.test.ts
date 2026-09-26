/**
 * @jest-environment node
 */

/**
 * The provider page's privacy notice holds its slot with a skeleton while the
 * catalog is out. A skeleton can only hold a slot confidently when every
 * answer that might replace it is the same height — so the four verdicts are
 * written to one shape (a one-line title, a two-line body) and this pins them
 * to a band around the placeholder. A rewrite that grows one variant by a line
 * fails here instead of shoving the stats grid down under the reader's thumb.
 */

import {
  PROVIDER_PRIVACY_SKELETON,
  providerPrivacyNotice,
} from '@/features/ai/lib/providerPrivacy';

/** Longest title that still fits one line at 15pt bold on the narrowest
 *  supported phone, with the notice's icon and padding taken off. */
const MAX_TITLE_CHARS = 40;

/** The body is two lines at 14pt on that width. A band, not an exact figure,
 *  because the partial verdict carries two counts of varying width. */
const BODY_BAND = { min: 85, max: 115 };

const VERDICTS = [
  { name: 'unknown', catalog: null },
  { name: 'empty catalog', catalog: { count: 0, encrypted: 0 } },
  { name: 'plaintext', catalog: { count: 582, encrypted: 0 } },
  { name: 'partly sealed', catalog: { count: 582, encrypted: 9 } },
  { name: 'partly sealed, wide counts', catalog: { count: 1_204, encrypted: 1_100 } },
  { name: 'fully sealed', catalog: { count: 10, encrypted: 10 } },
] as const;

describe('the privacy verdicts are all the same size', () => {
  it.each(VERDICTS)('$name fits the skeleton', ({ catalog }) => {
    const notice = providerPrivacyNotice(catalog);
    expect(notice.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(notice.body.length).toBeGreaterThanOrEqual(BODY_BAND.min);
    expect(notice.body.length).toBeLessThanOrEqual(BODY_BAND.max);
  });

  it('reserves the slot with a real verdict, not a made-up line', () => {
    expect(PROVIDER_PRIVACY_SKELETON.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(PROVIDER_PRIVACY_SKELETON.body.length).toBeGreaterThanOrEqual(BODY_BAND.min);
    expect(PROVIDER_PRIVACY_SKELETON.body.length).toBeLessThanOrEqual(BODY_BAND.max);
    const plaintext = providerPrivacyNotice({ count: 582, encrypted: 0 });
    expect(plaintext.title).toBe(PROVIDER_PRIVACY_SKELETON.title);
    expect(plaintext.body).toBe(PROVIDER_PRIVACY_SKELETON.body);
  });

  it('tells the four states apart', () => {
    expect(providerPrivacyNotice(null).status).toBe('info');
    expect(providerPrivacyNotice({ count: 582, encrypted: 0 }).status).toBe('warning');
    expect(providerPrivacyNotice({ count: 582, encrypted: 9 }).status).toBe('warning');
    expect(providerPrivacyNotice({ count: 10, encrypted: 10 }).status).toBe('success');
    // The partial verdict says how partial, with both counts.
    expect(providerPrivacyNotice({ count: 582, encrypted: 9 }).body).toContain('9 of its 582');
  });
});
