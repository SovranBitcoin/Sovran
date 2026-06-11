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

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { WALLETS, MINT1 } from '../_harness/fixtures';

/** 33-byte compressed pubkey: "02" + 32-byte x-only hex (Cashu↔Nostr convention). */
const LOCK_PUBKEY = `02${'ab'.repeat(32)}`;

describe('ecash send — P2PK locked', () => {
  it('passes the lock target to executeSend and surfaces it in sendComplete', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash', p2pkLockPubkey: LOCK_PUBKEY });

    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args).toEqual([MINT1, 100, undefined, { p2pkLockPubkey: LOCK_PUBKEY }]);

    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'sendComplete',
      data: { p2pkLockPubkey: LOCK_PUBKEY },
    });
  });

  it('normalizes the lock key to lowercase', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY.toUpperCase() });
    tm.assertContext({ p2pkLockPubkey: LOCK_PUBKEY });
  });

  it('skips the local-token-first shortcut even with exact local proofs', async () => {
    // WALLETS.default composes 100 exactly from local proofs, so an unlocked
    // send would take the localFirst path through executeOfflineSend.
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount(100, MINT1);

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
    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('error');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeUndefined();
  });

  it('fails fast when the app is offline instead of creating a local token', async () => {
    const tm = createTestMachine({ offline: true });
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('error');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeUndefined();
    expect(tm.operationCalls.find((call) => call.name === 'executeSend')).toBeUndefined();
  });

  it('does not route offline non-exact proofs to chooseProofs when locked', async () => {
    // Unlocked offline behavior for WALLETS.noExactProofs is the proof picker.
    // A locked send can never use local proofs, so it must error instead.
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs, offline: true });
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount(100, MINT1);

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

    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args[3]).toEqual({ p2pkLockPubkey: LOCK_PUBKEY });
  });

  it('unlocked sends are unaffected: localFirst still used with exact proofs', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('sendComplete');
    expect(tm.operationCalls.find((call) => call.name === 'executeOfflineSend')).toBeDefined();
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect((lastHandler.data as { p2pkLockPubkey?: string }).p2pkLockPubkey).toBeUndefined();
  });
});
