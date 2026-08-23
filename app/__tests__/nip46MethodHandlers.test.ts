/**
 * NIP-46 post-verdict method executors. Load-bearing cases: sign_event signs
 * EXACTLY the validated client event (no NDK tag/content rewriting) and the
 * returned JSON is a fully valid NIP-01 signed event — proven with real
 * schnorr crypto via nostr-tools (id recomputed + signature verified);
 * mismatched client pubkeys are refused; encrypt/decrypt route the right
 * scheme to the signer with an NDKUser peer; param validation fails closed.
 */

/* eslint-disable import/first */

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class MockNDK {},
    NDKPrivateKeySigner: class MockPrivateKeySigner {},
    NDKUser: class MockUser {
      pubkey: string;
      constructor(params: { pubkey: string }) {
        this.pubkey = params.pubkey;
      }
    },
    // virtual: ndk-mobile ships ESM-only exports jest-expo cannot resolve.
  }),
  { virtual: true }
);

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => ({
    name: 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import type { NDKPrivateKeySigner, NostrEvent } from '@nostr-dev-kit/ndk-mobile';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';

import {
  extractSignedEventId,
  isExecutableMethod,
  methodHandlers,
  type Nip46ExecutableMethod,
} from '@/features/nostrSigner/lib/methodHandlers';
import type { RpcRequest } from '@/features/nostrSigner/lib/nip46Types';

const PEER = 'b'.repeat(64);

function makeRequest(method: Nip46ExecutableMethod, params: string[]): RpcRequest {
  return { id: 'rpc-1', method, params };
}

/** Signer shim backed by real nostr-tools crypto for the sign path. */
function makeRealSigner() {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const signer = {
    sign: jest.fn(async (event: NostrEvent) => {
      return finalizeEvent(
        {
          kind: event.kind as number,
          created_at: event.created_at as number,
          tags: event.tags,
          content: event.content,
        },
        secretKey
      ).sig;
    }),
  } as unknown as NDKPrivateKeySigner;
  return { signer, pubkey };
}

function makeCryptoSigner() {
  return {
    nip04Encrypt: jest.fn(async (user: { pubkey: string }, value: string) => {
      return `enc04:${user.pubkey}:${value}`;
    }),
    nip04Decrypt: jest.fn(async (user: { pubkey: string }, value: string) => {
      return `dec04:${user.pubkey}:${value}`;
    }),
    nip44Encrypt: jest.fn(async (user: { pubkey: string }, value: string) => {
      return `enc44:${user.pubkey}:${value}`;
    }),
    nip44Decrypt: jest.fn(async (user: { pubkey: string }, value: string) => {
      return `dec44:${user.pubkey}:${value}`;
    }),
  };
}

const UNSIGNED = {
  kind: 1,
  content: 'hello nostr',
  tags: [['t', 'sovran']],
  created_at: 1_700_000_000,
};

describe('sign_event', () => {
  it('returns a fully valid signed event over exactly the requested fields', async () => {
    const { signer, pubkey } = makeRealSigner();
    const request = makeRequest('sign_event', [JSON.stringify(UNSIGNED)]);

    const result = await methodHandlers.sign_event({ signer, userPubkey: pubkey, request });

    const signed = JSON.parse(result._unsafeUnwrap()) as NostrToolsEvent;
    expect(signed).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      sig: expect.stringMatching(/^[0-9a-f]{128}$/) as string,
      pubkey,
      kind: UNSIGNED.kind,
      content: UNSIGNED.content,
      tags: UNSIGNED.tags,
      created_at: UNSIGNED.created_at,
    });
    expect(verifyEvent(signed)).toBe(true); // nostr-tools recomputes id AND checks sig
  });

  it('discards client-supplied id/sig/extra fields instead of echoing them', async () => {
    const { signer, pubkey } = makeRealSigner();
    const tampered = { ...UNSIGNED, id: 'z'.repeat(64), sig: 'z'.repeat(128), surprise: true };
    const request = makeRequest('sign_event', [JSON.stringify(tampered)]);

    const result = await methodHandlers.sign_event({ signer, userPubkey: pubkey, request });

    const signed = JSON.parse(result._unsafeUnwrap()) as NostrToolsEvent & { surprise?: boolean };
    expect(signed.surprise).toBeUndefined();
    expect(signed.id).not.toBe('z'.repeat(64));
    expect(verifyEvent(signed)).toBe(true);
  });

  it('accepts an empty-string pubkey and an uppercase userPubkey', async () => {
    const { signer, pubkey } = makeRealSigner();
    const request = makeRequest('sign_event', [JSON.stringify({ ...UNSIGNED, pubkey: '' })]);

    const result = await methodHandlers.sign_event({
      signer,
      userPubkey: pubkey.toUpperCase(),
      request,
    });

    const signed = JSON.parse(result._unsafeUnwrap()) as NostrToolsEvent;
    expect(signed.pubkey).toBe(pubkey);
    expect(verifyEvent(signed)).toBe(true);
  });

  it('refuses to sign for a different claimed author', async () => {
    const { signer, pubkey } = makeRealSigner();
    const forged = { ...UNSIGNED, pubkey: PEER };
    const request = makeRequest('sign_event', [JSON.stringify(forged)]);

    const result = await methodHandlers.sign_event({ signer, userPubkey: pubkey, request });

    expect(result._unsafeUnwrapErr()).toEqual({ type: 'malformed-params' });
    expect((signer.sign as jest.Mock).mock.calls).toHaveLength(0);
  });

  it.each([
    ['missing params', []],
    ['non-JSON params', ['not json']],
    ['schema failure (missing created_at)', [JSON.stringify({ kind: 1, content: '', tags: [] })]],
    ['millisecond created_at', [JSON.stringify({ ...UNSIGNED, created_at: Date.now() })]],
  ])('errs malformed-params on %s', async (_label, params) => {
    const { signer, pubkey } = makeRealSigner();
    const result = await methodHandlers.sign_event({
      signer,
      userPubkey: pubkey,
      request: makeRequest('sign_event', params),
    });
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'malformed-params' });
  });

  it('errs execution-failed when the signer throws', async () => {
    const signer = {
      sign: jest.fn().mockRejectedValue(new Error('no key')),
    } as unknown as NDKPrivateKeySigner;
    const result = await methodHandlers.sign_event({
      signer,
      userPubkey: 'a'.repeat(64),
      request: makeRequest('sign_event', [JSON.stringify(UNSIGNED)]),
    });
    expect(result._unsafeUnwrapErr().type).toBe('execution-failed');
  });
});

describe('encrypt/decrypt handlers', () => {
  it.each([
    ['nip04_encrypt', 'nip04Encrypt', 'enc04'],
    ['nip04_decrypt', 'nip04Decrypt', 'dec04'],
    ['nip44_encrypt', 'nip44Encrypt', 'enc44'],
    ['nip44_decrypt', 'nip44Decrypt', 'dec44'],
  ] as const)('%s routes peer + payload to signer.%s', async (method, signerMethod, prefix) => {
    const crypto = makeCryptoSigner();
    const result = await methodHandlers[method]({
      signer: crypto as unknown as NDKPrivateKeySigner,
      userPubkey: 'a'.repeat(64),
      request: makeRequest(method, [PEER, 'payload']),
    });

    expect(result._unsafeUnwrap()).toBe(`${prefix}:${PEER}:payload`);
    expect(crypto[signerMethod]).toHaveBeenCalledTimes(1);
    expect(crypto[signerMethod].mock.calls[0]?.[0]?.pubkey).toBe(PEER);
  });

  it('lowercases the peer pubkey handed to the signer', async () => {
    const crypto = makeCryptoSigner();
    await methodHandlers.nip44_encrypt({
      signer: crypto as unknown as NDKPrivateKeySigner,
      userPubkey: 'a'.repeat(64),
      request: makeRequest('nip44_encrypt', [PEER.toUpperCase(), 'x']),
    });
    expect(crypto.nip44Encrypt.mock.calls[0]?.[0]?.pubkey).toBe(PEER);
  });

  it.each([
    ['missing payload', [PEER]],
    ['missing peer', []],
    ['non-hex peer', ['not-a-pubkey', 'payload']],
  ])('errs malformed-params on %s', async (_label, params) => {
    const crypto = makeCryptoSigner();
    const result = await methodHandlers.nip44_decrypt({
      signer: crypto as unknown as NDKPrivateKeySigner,
      userPubkey: 'a'.repeat(64),
      request: makeRequest('nip44_decrypt', params),
    });
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'malformed-params' });
    expect(crypto.nip44Decrypt).not.toHaveBeenCalled();
  });

  it('errs execution-failed when decryption throws (bad ciphertext)', async () => {
    const crypto = makeCryptoSigner();
    crypto.nip44Decrypt.mockRejectedValue(new Error('invalid MAC'));
    const result = await methodHandlers.nip44_decrypt({
      signer: crypto as unknown as NDKPrivateKeySigner,
      userPubkey: 'a'.repeat(64),
      request: makeRequest('nip44_decrypt', [PEER, 'ciphertext']),
    });
    expect(result._unsafeUnwrapErr().type).toBe('execution-failed');
  });
});

describe('trivial methods', () => {
  // ping/get_public_key never touch the signer — any stub satisfies them.
  const unusedSigner = makeCryptoSigner() as unknown as NDKPrivateKeySigner;

  it('ping answers pong', async () => {
    const result = await methodHandlers.ping({
      signer: unusedSigner,
      userPubkey: 'a'.repeat(64),
      request: makeRequest('ping', []),
    });
    expect(result._unsafeUnwrap()).toBe('pong');
  });

  it('get_public_key answers the lowercased user pubkey', async () => {
    const result = await methodHandlers.get_public_key({
      signer: unusedSigner,
      userPubkey: 'A'.repeat(64),
      request: makeRequest('get_public_key', []),
    });
    expect(result._unsafeUnwrap()).toBe('a'.repeat(64));
  });
});

describe('helpers', () => {
  it('isExecutableMethod excludes connect only', () => {
    expect(isExecutableMethod('connect')).toBe(false);
    expect(isExecutableMethod('sign_event')).toBe(true);
    expect(isExecutableMethod('ping')).toBe(true);
  });

  it('extractSignedEventId pulls a 64-hex id and rejects garbage', () => {
    const id = 'c'.repeat(64);
    expect(extractSignedEventId(JSON.stringify({ id }))).toBe(id);
    expect(extractSignedEventId(JSON.stringify({ id: 'short' }))).toBeUndefined();
    expect(extractSignedEventId('not json')).toBeUndefined();
    expect(extractSignedEventId(JSON.stringify({ noId: true }))).toBeUndefined();
  });
});
