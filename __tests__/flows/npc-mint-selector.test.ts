/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * npc-mint-selector.test.ts — npub.cash deposit-mint selector
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The npub.cash ("npc") mint selector lets the user choose which mint backs
 * their npub.cash Lightning address. It is opened from the Receive screen and
 * is purely a settings-style change — it must NEVER advance a receive/send
 * flow into the amount selector.
 *
 * Regression: Receive → Fixed Amount → back → npub.cash selector → pick mint
 * used to reopen the amount selector. Tapping Fixed Amount sets a receive
 * `destination: 'mintQuote'` in machine context; backing out of that screen
 * is app navigation only, so the stale destination lingered. Selecting an NPC
 * mint then resolved that destination and reopened amount entry.
 *
 * Two guards prevent this:
 *   1. requestMintSelector({ scope: 'npc' }) opens the picker with clean
 *      context (drops the stale destination).
 *   2. changeMint(..., { scope: 'npc' }) is persist-only — it dismisses and
 *      notifies onNpcMintChanged, never advancing the flow.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { MINT1, MINT2 } from '../_harness/fixtures';

describe('npub.cash mint selector', () => {
  it('does not reopen the amount selector after Fixed Amount → back → pick NPC mint', async () => {
    const tm = createTestMachine();

    // Receive → Fixed Amount: enters Lightning amount entry (destination mintQuote).
    await tm.machine.startReceiveLightning({ reset: true });
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'mintQuote' });

    // User taps "back" out of Fixed Amount. Back is app navigation only — the
    // machine context still carries the stale receive destination.

    // Receive → npub.cash mint selector.
    await tm.machine.requestMintSelector({ scope: 'npc' });
    tm.assertStep('selectMint');
    // The picker opened with clean context — no stale receive destination.
    expect(tm.machine.getContext().destination).toBeUndefined();

    // User picks a mint for the npub.cash address.
    await tm.machine.changeMint(MINT2, { scope: 'npc' });

    // It must dismiss — NOT reopen the amount selector.
    tm.assertStep('dismiss');
    expect(tm.machine.getContext().destination).toBeUndefined();

    // The NPC mint change is reported via onNpcMintChanged so the app persists it.
    const npcNotices = tm.notificationCalls.filter((c) => c.key === 'onNpcMintChanged');
    expect(npcNotices).toHaveLength(1);
    expect(npcNotices[0].data).toMatchObject({ mintUrl: MINT2 });
  });

  it('changes the NPC mint cleanly without any prior flow context', async () => {
    const tm = createTestMachine();

    await tm.machine.requestMintSelector({ scope: 'npc' });
    tm.assertStep('selectMint');

    await tm.machine.changeMint(MINT1, { scope: 'npc' });
    tm.assertStep('dismiss');

    const npcNotices = tm.notificationCalls.filter((c) => c.key === 'onNpcMintChanged');
    expect(npcNotices).toHaveLength(1);
    expect(npcNotices[0].data).toMatchObject({ mintUrl: MINT1 });
    // NPC scope must never persist the preferred mint.
    expect(tm.notificationCalls.some((c) => c.key === 'onPreferredMintChanged')).toBe(false);
  });
});
