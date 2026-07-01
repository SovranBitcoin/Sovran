import { describe, expect, it, vi } from 'vitest';
import { getEncodedToken } from '@cashu/cashu-ts';
import { classifyMeshToken, meshTokenDedupeKey } from '../../src/transport/classify';
import {
  classifyMeshRedeemError,
  createMeshRedeemOrchestrator,
  type MeshRedeemEntry,
} from '../../src/transport/redeemOrchestrator';

const MY_PUBKEY = `02${'ab'.repeat(32)}`;
const OTHER_PUBKEY = `02${'cd'.repeat(32)}`;
const MINT_URL = 'https://mint.test';
const KEYSET_ID = '009a1f293253e41e';

function p2pkSecret(pubkey: string, tags?: string[][]): string {
  return JSON.stringify([
    'P2PK',
    { nonce: '11'.repeat(16), data: pubkey, ...(tags ? { tags } : {}) },
  ]);
}

function proof(secret: string, amount = 2) {
  return { amount, id: KEYSET_ID, secret, C: `02${'ef'.repeat(32)}` };
}

function encode(proofs: ReturnType<typeof proof>[]): string {
  return getEncodedToken({ mint: MINT_URL, proofs, unit: 'sat' });
}

// ---------------------------------------------------------------------------
// classify (port of sovran-app nutDropTokens suite)
// ---------------------------------------------------------------------------

describe('classifyMeshToken', () => {
  it('classifies a token fully locked to my key', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY), 2), proof(p2pkSecret(MY_PUBKEY), 4)]);
    expect(classifyMeshToken(token, MY_PUBKEY)).toEqual({
      classification: 'locked-to-me',
      mintUrl: MINT_URL,
      amount: 6,
      unit: 'sat',
    });
  });

  it('matches the lock key case-insensitively', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY))]);
    expect(classifyMeshToken(token, MY_PUBKEY.toUpperCase()).classification).toBe('locked-to-me');
  });

  it("never classifies the sender's own broadcast echo as locked-to-me", () => {
    const senderEcho = encode([proof(p2pkSecret(OTHER_PUBKEY), 21)]);
    expect(classifyMeshToken(senderEcho, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('treats mixed locked + bearer proofs as locked-to-other', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY)), proof('aa'.repeat(32))]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('treats multisig locks as locked-to-other even when my key is included', () => {
    const token = encode([
      proof(
        p2pkSecret(MY_PUBKEY, [
          ['pubkeys', OTHER_PUBKEY],
          ['n_sigs', '2'],
        ])
      ),
    ]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('never classifies non-P2PK spending conditions as bearer (HTLC etc.)', () => {
    const htlcSecret = JSON.stringify(['HTLC', { nonce: '11'.repeat(16), data: 'ab'.repeat(32) }]);
    expect(classifyMeshToken(encode([proof(htlcSecret)]), MY_PUBKEY).classification).toBe(
      'locked-to-other'
    );
    expect(
      classifyMeshToken(encode([proof('aa'.repeat(32)), proof(htlcSecret)]), MY_PUBKEY)
        .classification
    ).toBe('locked-to-other');
  });

  it('classifies plain-secret tokens as bearer and junk as invalid', () => {
    expect(classifyMeshToken(encode([proof('aa'.repeat(32))]), MY_PUBKEY).classification).toBe(
      'bearer'
    );
    expect(classifyMeshToken('cashuBnotatoken', MY_PUBKEY).classification).toBe('invalid');
    expect(classifyMeshToken('', MY_PUBKEY).classification).toBe('invalid');
  });
});

describe('meshTokenDedupeKey', () => {
  it('is stable for the same token and distinct for different tokens', () => {
    const a = encode([proof(p2pkSecret(MY_PUBKEY))]);
    const b = encode([proof(p2pkSecret(OTHER_PUBKEY))]);
    expect(meshTokenDedupeKey(a)).toBe(meshTokenDedupeKey(a));
    expect(meshTokenDedupeKey(a)).not.toBe(meshTokenDedupeKey(b));
    expect(meshTokenDedupeKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// redeem orchestrator
// ---------------------------------------------------------------------------

function entry(overrides: Partial<MeshRedeemEntry> = {}): MeshRedeemEntry {
  return {
    token: 'cashuB...',
    mintUrl: MINT_URL,
    amount: 21,
    unit: 'sat',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    receivedAt: 0,
    ...overrides,
  };
}

function createQueue(initial: Record<string, MeshRedeemEntry>) {
  const statuses: Array<[string, string]> = [];
  const retries: string[] = [];
  return {
    port: {
      prune: () => {},
      entries: () => initial,
      markStatus: (hash: string, status: string) => statuses.push([hash, status]),
      scheduleRetry: (hash: string) => retries.push(hash),
    },
    statuses,
    retries,
  };
}

function fakeManager(trusted = true) {
  // Stable identity: the orchestrator aborts a drain if getManager() returns
  // a different object mid-drain (profile-switch guard).
  const manager = { mint: { isTrustedMint: async () => trusted } } as never;
  return () => manager;
}

describe('createMeshRedeemOrchestrator', () => {
  it('redeems due trusted entries through executeAutoRedeem', async () => {
    const queue = createQueue({ h1: entry() });
    const redeemed: string[] = [];
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async (token) => {
        redeemed.push(token);
        return { historyEntryId: 'hist1' };
      },
      onRedeemed: (hash, _entry, historyEntryId) => {
        expect([hash, historyEntryId]).toEqual(['h1', 'hist1']);
      },
    });
    await orchestrator.drain();
    expect(redeemed).toEqual(['cashuB...']);
    expect(queue.statuses).toEqual([
      ['h1', 'redeeming'],
      ['h1', 'redeemed'],
    ]);
  });

  it('parks untrusted-mint entries without touching the wallet', async () => {
    const queue = createQueue({ h1: entry() });
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(false),
      queue: queue.port,
      executeAutoRedeem: async () => {
        throw new Error('must not be called');
      },
    });
    await orchestrator.drain();
    expect(queue.statuses).toEqual([['h1', 'untrusted-mint']]);
  });

  it('classifies errors: spent terminal, network retried, fatal failed', async () => {
    const queue = createQueue({
      spent: entry(),
      net: entry(),
      fatal: entry(),
    });
    const errors: Record<string, Error> = {
      spent: new Error('Token was already spent'),
      net: new Error('fetch failed: network down'),
      fatal: new Error('proof verification failed'),
    };
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async (token) => {
        throw errors[token as keyof typeof errors] ?? new Error('unknown');
      },
    });
    // Tokens double as keys for the fixture.
    queue.port.entries = () => ({
      spent: entry({ token: 'spent' }),
      net: entry({ token: 'net' }),
      fatal: entry({ token: 'fatal' }),
    });
    await orchestrator.drain();
    expect(queue.statuses).toContainEqual(['spent', 'spent']);
    expect(queue.retries).toEqual(['net']);
    expect(queue.statuses).toContainEqual(['fatal', 'failed']);
  });

  it('gates on manager availability, restore status, and backoff windows', async () => {
    const queue = createQueue({ h1: entry({ nextAttemptAt: Number.MAX_SAFE_INTEGER }) });
    const execute = vi.fn(async () => ({ historyEntryId: null }));

    const noManager = createMeshRedeemOrchestrator({
      getManager: () => null,
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await noManager.drain();

    const restoring = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
      isRestoreSettled: () => false,
    });
    await restoring.drain();

    const backoff = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await backoff.drain();

    expect(execute).not.toHaveBeenCalled();
    expect(queue.statuses).toEqual([]);
  });
});

describe('classifyMeshRedeemError', () => {
  it('maps message patterns to kinds', () => {
    expect(classifyMeshRedeemError(new Error('Token already   spent'))).toBe('spent');
    expect(classifyMeshRedeemError(new Error('request timed out'))).toBe('network');
    expect(classifyMeshRedeemError(new Error('key pair not found for keyset'))).toBe('retryable');
    expect(classifyMeshRedeemError(new Error('bad signature'))).toBe('fatal');
  });
});
