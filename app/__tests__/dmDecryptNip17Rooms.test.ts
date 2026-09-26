import { decryptDmEnvelopes } from '@/features/payments/data/dmDecryptPipeline';
import type { DmEnvelope } from '@/features/payments/data/dmEnvelopeTypes';

const viewer = 'a'.repeat(64);
const peer = 'b'.repeat(64);
const third = 'c'.repeat(64);
const mockUnwrap = jest.fn();
jest.mock('@/shared/lib/nostr/nip17', () => ({
  unwrapGiftWrap: (...args: unknown[]) => mockUnwrap(...args),
}));
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { cache: { get: () => undefined, put: jest.fn() } },
}));
jest.mock('@/shared/lib/nostr/nip04Cache', () => ({ nip04Cache: {} }));
jest.mock('@/shared/lib/nostr/nip04', () => ({ decryptNip04: jest.fn() }));
const envelope: DmEnvelope = {
  id: 'fixture',
  kind: 1059,
  pubkey: peer,
  createdAt: 1,
  content: 'sealed',
  tags: [],
  sig: '',
};

it.each([
  [peer, [viewer, third], 0],
  [viewer, [peer, third], 0],
  [peer, [third], 0],
  [viewer, [viewer], 0],
  [peer, [viewer], 1],
  [viewer, [peer], 1],
] as const)(
  'keeps only the viewer’s one-to-one room (%s, %j)',
  (senderPubkey, recipientPubkeys, count) => {
    mockUnwrap.mockReturnValue({
      kind: 14,
      senderPubkey,
      recipientPubkeys,
      content: 'hello',
      created_at: 1,
    });
    expect(decryptDmEnvelopes([envelope], viewer, new Uint8Array(32))).toHaveLength(count);
  }
);
