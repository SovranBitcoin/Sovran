/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ecash-send-p2pk.test.ts — P2PK-Locked Ecash Send Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests sends started with a P2PK lock target (`p2pkLockPubkey`). A locked
 * send must produce P2PK-locked outputs via a mint swap — it must NEVER
 * silently degrade to a bearer token. That means:
 *
 *   - executeSend receives the lock target and forwards it to coco
 *   - sendComplete data carries p2pkLockPubkey so consumers can verify it
 *   - the local-token-first shortcut is disabled (local proofs carry no lock)
 *   - the offline fallback after a mint failure is disabled
 *   - offline locked sends fail fast instead of routing to chooseProofs
 *   - malformed lock keys abort the flow instead of being dropped
 */

import { afterEach, describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { WALLETS, MINT1 } from '../_harness/fixtures';
import { setLogger } from '../../src/logger';

/** 33-byte compressed pubkey: "02" + 32-byte x-only hex (Cashu↔Nostr convention). */
const LOCK_PUBKEY = `02${'ab'.repeat(32)}`;
/** Our own keyring key — the one a refund path would have to sign with. */
const REFUND_PUBKEY = `02${'cd'.repeat(32)}`;
/** A key from a wallet that does not derive from a nostr identity. */
const ODD_PARITY_PUBKEY = `03${'ef'.repeat(32)}`;
const LOCKTIME_SEC = 1_800_003_600;

afterEach(() => setLogger(null));

describe('ecash send — P2PK locked', () => {
  // A raw compressed key is what cashu.me / Macadamia / Minibits publish for
  // receiving locked ecash. It is NOT a nostr identity, so it must never stop
  // at a profile or ask "send how?" — locking is the only thing it affords.
  it.each(['02', '03'])(
    'scanning a %s Cashu key starts a required locked send',
    async (prefix) => {
      const key = `${prefix}79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`;
      const tm = createTestMachine();

      await tm.machine.execute(key);

      tm.assertStep('enterAmount');
      tm.assertContext({ destination: 'sendEcash', p2pkLockPubkey: key });
      // Parity is part of the lock target: the derived x-only hex must not
      // stand in for it, and the npub identity must not be adopted.
      expect(tm.machine.getContext().p2pkLock).toEqual({ pubkey: key });
      expect(tm.machine.getContext().recipientPubkey).toBeUndefined();
      expect(tm.machine.getContext().recipientProfile).toBeUndefined();
      // The openProfile intent must not survive, or the next event resolves
      // through it again instead of completing the send.
      expect(tm.machine.getContext().intent).toBeUndefined();

      await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

      tm.assertStep('sendComplete');
      expect(tm.operationCalls.find((call) => call.name === 'executeSend')?.args).toEqual([
        MINT1,
        100,
        undefined,
        { p2pkLockPubkey: key, p2pkLock: { pubkey: key } },
      ]);
    }
  );

  it('still opens the profile for an npub, which affords more than locking', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(
      'npub1zuuajd7u3sx8xu92yav9jwxpr839cs0kc3q6t56vd5u9q033xmhsk6c2uc'
    );
    tm.assertStep('openProfile');
  });
  it('passes the lock target to executeSend and surfaces it in sendComplete', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash', p2pkLockPubkey: LOCK_PUBKEY });
    expect(tm.handlerCalls.at(-1)).toMatchObject({
      step: 'enterAmount',
      data: { constraints: { p2pkLockPubkey: LOCK_PUBKEY } },
    });

    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    // The terms are what the operation acts on; the bare key rides along for
    // the many call sites that only ask "is this locked".
    expect(sendCall?.args).toEqual([
      MINT1,
      100,
      undefined,
      { p2pkLockPubkey: LOCK_PUBKEY, p2pkLock: { pubkey: LOCK_PUBKEY } },
    ]);

    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'sendComplete',
      data: { p2pkLockPubkey: LOCK_PUBKEY },
    });
  });

  it('normalizes the lock key to lowercase', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({
      p2pkLockPubkey: LOCK_PUBKEY.toUpperCase(),
    });
    tm.assertContext({ p2pkLockPubkey: LOCK_PUBKEY });
  });

  it('logs lock presence without logging the raw lock target', async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const record = (event: string, fields?: Record<string, unknown>) => {
      logs.push({ event, fields });
    };
    setLogger({ debug: record, info: record, warn: record, error: record });

    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    expect(logs.some(({ fields }) => fields?.p2pkLocked === true)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(LOCK_PUBKEY);
  });

  it('skips the local-token-first shortcut even with exact local proofs', async () => {
    // WALLETS.default composes 100 exactly from local proofs, so an unlocked
    // send would take the localFirst path through executeOfflineSend.
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('sendComplete');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeUndefined();
    expect(tm.operationCalls.find((call) => call.name === 'executeSend')).toBeDefined();
  });

  it('does not fall back to an offline (bearer) token when the mint is unreachable', async () => {
    // Unlocked behavior with exact proofs would absorb a mint-offline failure
    // by creating a local token. Locked sends must surface the failure.
    const mintOffline = new Error('Mint unreachable');
    mintOffline.name = 'MintFetchError';
    const tm = createTestMachine({
      operations: {
        executeSend: async () => {
          throw mintOffline;
        },
      },
    });

    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('error');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeUndefined();
  });

  it('fails fast when the app is offline instead of creating a local token', async () => {
    const tm = createTestMachine({ offline: true });
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('error');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeUndefined();
    expect(tm.operationCalls.find((call) => call.name === 'executeSend')).toBeUndefined();
  });

  it('does not route offline non-exact proofs to chooseProofs when locked', async () => {
    // Unlocked offline behavior for WALLETS.noExactProofs is the proof picker.
    // A locked send can never use local proofs, so it must error instead.
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      offline: true,
    });
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('error');
    expect(tm.handlerCalls.find((call) => call.step === 'chooseProofs')).toBeUndefined();
  });

  it('rejects a malformed lock key instead of silently dropping the lock', async () => {
    const tm = createTestMachine();
    // 64-hex x-only key without the required "02" prefix.
    await tm.machine.startSendEcash({ p2pkLockPubkey: 'ab'.repeat(32) });

    tm.assertStep('error');
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'error',
      data: { code: 'INVALID_P2PK_LOCK' },
    });
  });

  it('keeps the lock through a mid-flow mint change', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.requestMintSelector({ scope: 'selected' });
    await tm.machine.changeMint(MINT1);
    tm.assertContext({ p2pkLockPubkey: LOCK_PUBKEY });
    expect(tm.handlerCalls.at(-1)).toMatchObject({
      step: 'enterAmount',
      data: { constraints: { p2pkLockPubkey: LOCK_PUBKEY } },
    });

    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);
    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args[3]).toEqual({
      p2pkLockPubkey: LOCK_PUBKEY,
      p2pkLock: { pubkey: LOCK_PUBKEY },
    });
  });

  it('carries a locktime and a refund key through to the mint call', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({
      p2pkLock: {
        pubkey: LOCK_PUBKEY,
        locktimeSec: LOCKTIME_SEC,
        refundKeys: [REFUND_PUBKEY],
      },
    });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args[3]).toMatchObject({
      p2pkLock: {
        pubkey: LOCK_PUBKEY,
        locktimeSec: LOCKTIME_SEC,
        refundKeys: [REFUND_PUBKEY],
      },
    });
  });

  it('refuses a locktime with no way back, instead of sending it', async () => {
    // Past that locktime the proof needs no signature at all: anyone holding
    // the token could redeem it, while the sender was told the opposite.
    const tm = createTestMachine();
    await tm.machine.startSendEcash({
      p2pkLock: { pubkey: LOCK_PUBKEY, locktimeSec: LOCKTIME_SEC },
    });
    tm.assertStep('error');
    expect(tm.operationCalls.find((call) => call.name === 'executeSend')).toBeUndefined();
  });

  it('accepts an odd-parity key from another wallet', async () => {
    // The old guard hardcoded ^02, which would reject every key published by
    // a wallet that does not derive from a nostr identity.
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: ODD_PARITY_PUBKEY });
    tm.assertStep('enterAmount');
    tm.assertContext({ p2pkLockPubkey: ODD_PARITY_PUBKEY });
  });

  it('takes a lock chosen on the amount screen, not only at flow start', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      p2pkLock: {
        pubkey: LOCK_PUBKEY,
        locktimeSec: LOCKTIME_SEC,
        refundKeys: [REFUND_PUBKEY],
      },
    });

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args[3]).toMatchObject({
      p2pkLock: { pubkey: LOCK_PUBKEY, locktimeSec: LOCKTIME_SEC },
    });
  });

  it.each([false, true])('rejects invalid amount-screen lock terms (seeded: %s)', async (seeded) => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash(seeded ? { p2pkLockPubkey: LOCK_PUBKEY } : {});
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      p2pkLock: { pubkey: LOCK_PUBKEY, locktimeSec: LOCKTIME_SEC },
    });

    tm.assertStep('error');
    expect(tm.handlerCalls.at(-1)).toMatchObject({
      step: 'error',
      data: { code: 'INVALID_P2PK_LOCK' },
    });
    expect(tm.operationCalls).toEqual([]);
  });

  it('lets the amount screen turn a seeded lock back off', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      p2pkLock: null,
    });

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    // Both fields must clear together: leaving the mirrored key behind would
    // keep every "is this locked" check true while the terms were gone.
    expect(sendCall?.args[3]).toBeUndefined();
  });

  it('leaves a seeded lock alone when the screen says nothing about it', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args[3]).toMatchObject({ p2pkLockPubkey: LOCK_PUBKEY });
  });

  it('unlocked sends are unaffected: localFirst still used with exact proofs', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('sendComplete');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeDefined();
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect((lastHandler.data as { p2pkLockPubkey?: string }).p2pkLockPubkey).toBeUndefined();
  });
});
