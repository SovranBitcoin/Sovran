import { renderHook } from '@testing-library/react-native';

import { transactionIdentitySnapshot, useTransactionIdentity } from '../lib/transactionIdentity';

type Metadata = { metadata?: Record<string, string> };

let mockProfile: { displayName?: string; name?: string; picture?: string } | undefined;
let mockResolving = false;
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: (pubkey: string | undefined) => ({
    metadata: pubkey ? mockProfile : undefined,
    isLoading: false,
    isResolving: mockResolving,
  }),
}));

const RECIPIENT = 'a'.repeat(64);
const COUNTERPARTY = 'b'.repeat(64);
const AUTHOR = 'c'.repeat(64);

const zapped: Metadata = {
  metadata: {
    zapEventId: 'e'.repeat(64),
    zapAuthorPubkey: AUTHOR,
    zapAuthorName: 'Post Author',
    zapAuthorAvatarUrl: 'https://example.test/author.png',
  },
};

beforeEach(() => {
  mockProfile = undefined;
  mockResolving = false;
});

describe('transactionIdentitySnapshot', () => {
  it('prefers the send flow’s transient recipient over both annotations', () => {
    expect(
      transactionIdentitySnapshot({
        metadata: {
          ...zapped.metadata,
          counterpartyPubkey: COUNTERPARTY,
          counterpartyDisplayName: 'Annotated',
          recipientPubkey: RECIPIENT,
          recipientDisplayName: 'Live Recipient',
          recipientAvatarUrl: 'https://example.test/live.png',
        },
      })
    ).toEqual({
      pubkey: RECIPIENT,
      name: 'Live Recipient',
      picture: 'https://example.test/live.png',
    });
  });

  it('falls back to the persisted counterparty once the preview metadata is gone', () => {
    expect(
      transactionIdentitySnapshot({
        metadata: {
          ...zapped.metadata,
          counterpartyPubkey: COUNTERPARTY,
          counterpartyDisplayName: 'Annotated',
          counterpartyDirection: 'recipient',
        },
      })
    ).toEqual({ pubkey: COUNTERPARTY, name: 'Annotated', picture: undefined });
  });

  it('names the zapped post’s author when nothing else identifies the payee', () => {
    expect(transactionIdentitySnapshot(zapped)).toEqual({
      pubkey: AUTHOR,
      name: 'Post Author',
      picture: 'https://example.test/author.png',
    });
  });

  it('has no identity for a plain transaction or a missing entry', () => {
    expect(
      transactionIdentitySnapshot({ metadata: { meltTarget: 'user@example.test' } })
    ).toBeUndefined();
    expect(transactionIdentitySnapshot(undefined)).toBeUndefined();
  });
});

describe('useTransactionIdentity', () => {
  it('morphs a zapped transaction to the author, seeded by their pubkey', () => {
    const { result } = renderHook(() => useTransactionIdentity(zapped));
    expect(result.current).toEqual({
      name: 'Post Author',
      seed: AUTHOR,
      picture: 'https://example.test/author.png',
      kind: 'person',
      isLoading: false,
    });
  });

  it('names a counterparty the transaction never captured from the live profile', () => {
    mockProfile = { displayName: 'Resolved Later', picture: 'https://example.test/kind0.png' };
    const { result } = renderHook(() =>
      useTransactionIdentity({ metadata: { counterpartyPubkey: COUNTERPARTY } })
    );
    expect(result.current).toEqual({
      name: 'Resolved Later',
      seed: COUNTERPARTY,
      picture: 'https://example.test/kind0.png',
      kind: 'person',
      isLoading: false,
    });
  });

  it('keeps the plain title for a pubkey no source can name', () => {
    mockResolving = true;
    const { result } = renderHook(() =>
      useTransactionIdentity({ metadata: { counterpartyPubkey: COUNTERPARTY } })
    );
    expect(result.current).toBeUndefined();
  });

  it('holds the avatar placeholder while a named person’s picture resolves', () => {
    mockResolving = true;
    mockProfile = { name: 'Pictureless' };
    const { result } = renderHook(() =>
      useTransactionIdentity({ metadata: { counterpartyPubkey: COUNTERPARTY } })
    );
    expect(result.current).toMatchObject({ name: 'Pictureless', picture: null, isLoading: true });
  });
});
