import { nip19 } from 'nostr-tools';
import { transactionIdentitySnapshot } from '@/features/transactions/lib/transactionIdentity';

jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({ useNostrProfileMetadata: jest.fn() }));

const pubkey = 'ab'.repeat(32);

it.each(['recipientPubkey', 'counterpartyPubkey', 'zapAuthorPubkey'])(
  'normalizes %s npubs before profile lookup and navigation',
  (field) => {
    expect(
      transactionIdentitySnapshot({ metadata: { [field]: nip19.npubEncode(pubkey) } })?.pubkey
    ).toBe(pubkey);
  }
);

it('falls back from an invalid preview identity to a valid annotation', () => {
  expect(
    transactionIdentitySnapshot({
      metadata: { recipientPubkey: 'invalid', counterpartyPubkey: pubkey },
    })?.pubkey
  ).toBe(pubkey);
});
