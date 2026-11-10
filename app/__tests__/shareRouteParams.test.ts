/**
 * @jest-environment node
 *
 * Characterization of the Share route's deep-link params: which `type` and
 * `data` pairs are accepted, so a link cannot render a foreign Lightning
 * address or key under the person's identity.
 */

import { shareRouteParamsSchema } from '@/features/user/lib/shareRouteParams';

const NPUB = `npub1${'q'.repeat(58)}`;
const HEX64 = 'ab'.repeat(32);
const COMPRESSED = `02${'cd'.repeat(32)}`;
const LUD16 = 'satoshi@example.com';

const schema = shareRouteParamsSchema('npub');

describe('shareRouteParamsSchema', () => {
  it.each([
    ['npub', NPUB],
    ['npub', HEX64],
    ['profile', NPUB],
    ['profile', HEX64],
    ['p2pk', COMPRESSED],
    ['lud16', LUD16],
  ])('accepts type=%s with matching data', (type, data) => {
    expect(schema.safeParse({ type, data }).success).toBe(true);
  });

  it('rejects a type outside the four share types', () => {
    expect(schema.safeParse({ type: 'invoice', data: NPUB }).success).toBe(false);
  });

  it('uses the route default when the link has no type', () => {
    const parsed = shareRouteParamsSchema('lud16').safeParse({ data: LUD16 });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.type).toBe('lud16');
    expect(shareRouteParamsSchema('p2pk').safeParse({ data: LUD16 }).success).toBe(false);
  });

  it.each([
    ['npub', LUD16],
    ['profile', COMPRESSED],
    ['p2pk', HEX64],
    ['p2pk', NPUB],
    ['lud16', NPUB],
  ])('rejects type=%s whose data has another shape', (type, data) => {
    const parsed = schema.safeParse({ type, data });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['data'], message: `data does not match type=${type}` })
    );
  });

  it('rejects empty data and data over 512 characters', () => {
    expect(schema.safeParse({ type: 'npub', data: '' }).success).toBe(false);
    expect(
      schema.safeParse({ type: 'lud16', data: `${'a'.repeat(500)}@${'b'.repeat(20)}.com` }).success
    ).toBe(false);
  });

  it('rejects a malformed secondary npub or Lightning address', () => {
    expect(schema.safeParse({ type: 'npub', data: NPUB, npub: 'npub1short' }).success).toBe(false);
    expect(schema.safeParse({ type: 'npub', data: NPUB, lud16: 'not an address' }).success).toBe(
      false
    );
  });

  it('accepts a secondary npub that differs from the shared one', () => {
    const otherNpub = `npub1${'p'.repeat(58)}`;

    // QUIRK: nothing ties the secondary `npub` to `data`, so a link can pair one identity's
    // npub with another's. A fix that cross-checks them should change this assertion on
    // purpose.
    expect(schema.safeParse({ type: 'npub', data: NPUB, npub: otherNpub }).success).toBe(true);
  });
});
