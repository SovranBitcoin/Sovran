/**
 * fetchNostrProfile parses nagg v2's /nostr/profile providers envelope into
 * the app-facing NostrProfileFull shape. Fixture captured from the live v2
 * deployment 2026-07-05 (fiatjaf) — the regression that motivated this test:
 * the v1 schema silently rejected every v2 response, so profile pages fell
 * back to the cache tier and lost reputation + joined date.
 */
import liveEnvelope from './fixtures/profile-v2-live.json';
import { __parseNostrProfileForTest } from '@/shared/lib/apiClient';

const FIATJAF = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

describe('nostr/profile v2 envelope mapping', () => {
  it('maps the live envelope into NostrProfileFull', () => {
    const result = __parseNostrProfileForTest(FIATJAF)(liveEnvelope);
    expect(result.isOk()).toBe(true);
    const p = result._unsafeUnwrap();
    expect(p.pubkey).toBe(FIATJAF);
    expect(p.npub.startsWith('npub1')).toBe(true);
    expect(p.name).toBe('fiatjaf');
    // Vertex provider payload (rank may be 0 on a young graph — presence, not value).
    expect(typeof p.rank).toBe('number');
    // Started date comes from providers.nagg.firstEventAt.
    expect(p.created_at).toBe(1697051805);
    // nip05 validity from the nip05 provider namespace.
    expect(p.nip05Valid).toBe(true);
    // following count from the pubkey-keyed aggregates.
    expect(p.follows).toBeGreaterThan(0);
    // Zero-omitted followers map to 0, not a parse failure.
    expect(typeof p.followers).toBe('number');
  });

  it('rejects a non-envelope body', () => {
    expect(__parseNostrProfileForTest(FIATJAF)({ pubkey: FIATJAF }).isErr()).toBe(true);
  });
});
