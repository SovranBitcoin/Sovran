/** @jest-environment node */
import { ok } from 'neverthrow';
import { facade } from 'nostr';

import { fetchFollowingCountViaFacade } from '@/shared/lib/nostr/fetchProfiles';

// Audit D12: the profile header's following count read a whole contact list
// with every followee's profile bundled, to show one number.

let mockLayer: facade.NostrDataLayer;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));

const SUBJECT = 'a'.repeat(64);
const FOLLOWED = Array.from({ length: 300 }, (_, index) => index.toString(16).padStart(64, '0'));

it('counts follows from the contact list alone and caches none of the people followed', async () => {
  const asked: unknown[] = [];
  mockLayer = facade.createNostrDataLayer({
    tiers: [
      facade.primal.createPrimalTier({
        connection: {
          request: async (request) => {
            asked.push(request);
            const extended = (request.params as { extended_response?: boolean }).extended_response;
            return ok([
              {
                id: '1'.repeat(64),
                pubkey: SUBJECT,
                kind: 3,
                content: '',
                tags: FOLLOWED.map((pubkey) => ['p', pubkey]),
                created_at: 1_700_000_000,
              },
              // What the cache sends when asked for the extended response.
              ...(extended
                ? FOLLOWED.map((pubkey) => ({
                    id: `${pubkey.slice(2)}bb`,
                    pubkey,
                    kind: 0,
                    content: '{"name":"followee"}',
                    created_at: 1_700_000_000,
                  }))
                : []),
            ]);
          },
        },
      }),
    ],
  });

  await expect(fetchFollowingCountViaFacade(SUBJECT)).resolves.toBe(300);

  expect(asked).toEqual([
    { verb: 'contact_list', params: { pubkey: SUBJECT, extended_response: false } },
  ]);
  expect(mockLayer.cache.profiles.size).toBe(0);
});
