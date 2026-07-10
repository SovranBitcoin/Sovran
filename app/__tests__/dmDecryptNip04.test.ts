/**
 * NIP-04 (kind 4) branch of the DM decrypt pipeline: received DMs key on the
 * author, sent DMs key on the `p` tag (and are marked own), and undecryptable
 * envelopes are skipped (and negatively cached) rather than throwing.
 */
import { finalizeEvent, generateSecretKey, getPublicKey, nip04 } from 'nostr-tools';
import { decryptDmEnvelopes } from '@/features/payments/data/dmDecryptPipeline';
import type { DmEnvelope } from '@/features/payments/data/dmEnvelopeClient';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const viewerSk = generateSecretKey();
const viewerPk = getPublicKey(viewerSk);
const peerSk = generateSecretKey();
const peerPk = getPublicKey(peerSk);

function toEnvelope(ev: {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
}): DmEnvelope {
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    kind: 4,
    createdAt: ev.created_at,
    content: ev.content,
    tags: ev.tags,
    sig: ev.sig,
  };
}

function receivedDm(content: string): DmEnvelope {
  const ev = finalizeEvent(
    {
      kind: 4,
      content: nip04.encrypt(peerSk, viewerPk, content),
      created_at: 1_700_000_000,
      tags: [['p', viewerPk]],
    },
    peerSk
  );
  return toEnvelope(ev);
}

function sentDm(content: string): DmEnvelope {
  const ev = finalizeEvent(
    {
      kind: 4,
      content: nip04.encrypt(viewerSk, peerPk, content),
      created_at: 1_700_000_100,
      tags: [['p', peerPk]],
    },
    viewerSk
  );
  return toEnvelope(ev);
}

describe('decryptDmEnvelopes — NIP-04 (kind 4)', () => {
  afterAll(async () => {
    await nip04Cache.clear(viewerPk);
  });

  it('decrypts a received DM with counterparty = author', () => {
    const out = decryptDmEnvelopes([receivedDm('hello from peer')], viewerPk, viewerSk);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      counterparty: peerPk,
      content: 'hello from peer',
      isOwn: false,
      protocol: 'nip04',
      createdAt: 1_700_000_000,
    });
  });

  it('decrypts a sent DM with counterparty = p tag and isOwn', () => {
    const out = decryptDmEnvelopes([sentDm('hi peer')], viewerPk, viewerSk);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      counterparty: peerPk,
      content: 'hi peer',
      isOwn: true,
      protocol: 'nip04',
    });
  });

  it('skips a malformed kind-4 envelope without throwing', () => {
    const env: DmEnvelope = {
      id: 'a'.repeat(64),
      pubkey: peerPk,
      kind: 4,
      createdAt: 1_700_000_300,
      content: 'not-valid-nip04-ciphertext',
      tags: [['p', viewerPk]],
      sig: '',
    };
    expect(() => decryptDmEnvelopes([env], viewerPk, viewerSk)).not.toThrow();
    expect(decryptDmEnvelopes([env], viewerPk, viewerSk)).toHaveLength(0);
  });

  it('ignores envelopes that are neither kind 4 nor 1059', () => {
    const env: DmEnvelope = {
      id: 'b'.repeat(64),
      pubkey: peerPk,
      kind: 1,
      createdAt: 1_700_000_400,
      content: 'a public note',
      tags: [],
      sig: '',
    };
    expect(decryptDmEnvelopes([env], viewerPk, viewerSk)).toHaveLength(0);
  });

  it('parses an ISO-8601 string createdAt to unix seconds (regression: 1970)', () => {
    // nagg may return `createdAt` as an ISO-8601 string; the old Number(raw)
    // path produced NaN -> 0 (1970). It must resolve to the real send time.
    const env: DmEnvelope = {
      ...receivedDm('legacy timestamp'),
      createdAt: new Date(1_700_000_000 * 1000).toISOString(),
    };
    const out = decryptDmEnvelopes([env], viewerPk, viewerSk);
    expect(out).toHaveLength(1);
    expect(out[0].createdAt).toBe(1_700_000_000);
  });

  it('downscales a millisecond numeric createdAt to seconds', () => {
    const env: DmEnvelope = {
      ...receivedDm('millis timestamp'),
      createdAt: 1_700_000_000_000,
    };
    const out = decryptDmEnvelopes([env], viewerPk, viewerSk);
    expect(out).toHaveLength(1);
    expect(out[0].createdAt).toBe(1_700_000_000);
  });
});
