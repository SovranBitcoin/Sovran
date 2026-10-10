/**
 * send-fallback.test.ts — a send picked on the amount screen failed, and a
 * different way to pay the same person can still work.
 *
 *   - An optional lock (added on the amount screen) that fails offers plain
 *     ecash; a lock the flow arrived with is a requirement and never does.
 *   - A recipient's own Lightning address that fails offers their npub.cash
 *     address, flagged as a caution; not when the mint was the problem.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { INPUTS, MINT1 } from '../_harness/fixtures';

const LOCK_PUBKEY = `02${'ab'.repeat(32)}`;
const RECIPIENT = 'cd'.repeat(32);
const NPC = 'npub1recipient@npubx.cash';

describe('send fallback — optional lock', () => {
  const failingLockedSend = () => {
    let calls = 0;
    const tm = createTestMachine({
      operations: {
        executeSend: async (_mint: string, _amount: number, _memo?: string, options?: unknown) => {
          calls += 1;
          if ((options as { p2pkLockPubkey?: string } | undefined)?.p2pkLockPubkey) {
            throw new Error('Mint rejected the lock');
          }
          return { historyEntry: JSON.stringify({ id: 'send-1', type: 'send' }) };
        },
      },
    });
    return { tm, calls: () => calls };
  };

  it('offers plain ecash and retries without the lock', async () => {
    const { tm } = failingLockedSend();
    await tm.machine.startSendEcash({ recipientPubkey: RECIPIENT });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      p2pkLock: { pubkey: LOCK_PUBKEY },
    });

    tm.assertStep('chooseSendFallback');
    const data = tm.handlerCalls.at(-1)?.data as {
      failed: { label: string; message: string };
      alternatives: { id: string }[];
    };
    expect(data.failed).toEqual({ label: 'as Locked Ecash', message: 'Mint rejected the lock' });
    expect(data.alternatives.map((alternative) => alternative.id)).toEqual(['ecash']);

    await tm.machine.chooseSendFallback('ecash');

    tm.assertStep('sendComplete');
    expect(tm.machine.getContext().p2pkLockPubkey).toBeUndefined();
    expect(tm.machine.getContext().recipientPubkey).toBe(RECIPIENT);
  });

  it('backing out lands on the original error', async () => {
    const { tm } = failingLockedSend();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      p2pkLock: { pubkey: LOCK_PUBKEY },
    });
    await tm.machine.chooseSendFallback(null);
    tm.assertStep('error');
  });

  it('never drops a lock the flow arrived with', async () => {
    const { tm } = failingLockedSend();
    await tm.machine.startSendEcash({ p2pkLockPubkey: LOCK_PUBKEY });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      p2pkLock: { pubkey: LOCK_PUBKEY, locktimeSec: 1_800_003_600 },
    });
    tm.assertStep('error');
  });
});

describe('send fallback — Lightning address to npub.cash', () => {
  const machineWithFailingMelt = (error: Error) =>
    createTestMachine({
      operations: {
        executeMelt: async () => {
          throw error;
        },
        npcAddressForPubkey: (pubkey: string) => (pubkey === RECIPIENT ? NPC : undefined),
      },
    });

  it('offers their npub.cash address as a caution', async () => {
    const tm = machineWithFailingMelt(new Error('LNURL invoice fetch failed'));
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1, {
      recipientPubkey: RECIPIENT,
    });
    await tm.machine.confirmMelt();

    tm.assertStep('chooseSendFallback');
    const data = tm.handlerCalls.at(-1)?.data as {
      alternatives: { id: string; isCaution?: boolean }[];
    };
    expect(data.alternatives).toEqual([
      expect.objectContaining({ id: 'lightning-npc', isCaution: true }),
    ]);

    await tm.machine.chooseSendFallback('lightning-npc');
    tm.assertStep('navigateToMeltPreview');
    expect(tm.machine.getContext().meltTarget).toBe(NPC);
  });

  it('offers nothing when the mint was unreachable', async () => {
    const offline = new Error('Mint unreachable');
    offline.name = 'MintFetchError';
    const tm = machineWithFailingMelt(offline);
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1, {
      recipientPubkey: RECIPIENT,
    });
    await tm.machine.confirmMelt();

    expect(tm.machine.getStep()).not.toBe('chooseSendFallback');
  });
});
