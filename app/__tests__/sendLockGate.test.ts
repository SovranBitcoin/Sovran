/**
 * @jest-environment node
 *
 * Whether a send can be locked. The distinction under test is the one the UI
 * turns into two different affordances: `unavailable` disables the control
 * because locking would fail, `unconfirmed` leaves it enabled because locking
 * will work but we cannot vouch for the recipient.
 */

import {
  deriveSendLockGate,
  REASON_MINT_NO_P2PK,
  REASON_NO_RECIPIENT,
  WARNING_MINT_NOT_LISTED,
  WARNING_UNCONFIRMED,
} from '@/features/send/lib/sendLockGate';
import type { NutzapProfile } from '@/shared/lib/nostr/nip61NutzapProfile';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

const RECIPIENT = 'a'.repeat(64);
const LOCK_KEY = `02${'b'.repeat(64)}` as CashuP2pkPubkey;
const MINT = 'https://mint.example';

const declared = (over: Partial<NutzapProfile> = {}): NutzapProfile => ({
  lockKey: LOCK_KEY,
  source: 'nutzapInfo',
  mints: [],
  relays: [],
  updatedAtSec: 1,
  ...over,
});

const assumed = (): NutzapProfile => declared({ source: 'identityFallback' });

const P2PK_MINT = { '11': { supported: true } };
const PLAIN_MINT = { '11': { supported: false } };

describe('deriveSendLockGate', () => {
  it('has nothing to lock to without a nostr recipient', () => {
    expect(
      deriveSendLockGate({
        nutzapProfile: declared(),
        nutzapLoading: false,
        selectedMintUrl: MINT,
        selectedMintNuts: P2PK_MINT,
      })
    ).toEqual({ kind: 'unavailable', reason: REASON_NO_RECIPIENT });
  });

  it('blocks on a mint that cannot honour a lock', () => {
    // Coco throws rather than falling back, so offering the toggle here would
    // promise something the send cannot deliver.
    expect(
      deriveSendLockGate({
        recipientPubkey: RECIPIENT,
        nutzapProfile: declared(),
        nutzapLoading: false,
        selectedMintUrl: MINT,
        selectedMintNuts: PLAIN_MINT,
      })
    ).toEqual({ kind: 'unavailable', reason: REASON_MINT_NO_P2PK });
  });

  it('does not block on a mint we simply have not read yet', () => {
    // Unknown is not "no". Disabling here would hide the control on a slow
    // network and never bring it back.
    expect(
      deriveSendLockGate({
        recipientPubkey: RECIPIENT,
        nutzapProfile: declared(),
        nutzapLoading: false,
        selectedMintUrl: MINT,
        selectedMintNuts: undefined,
      })
    ).toEqual({ kind: 'ready', lockKey: LOCK_KEY });
  });

  it('is ready when they declared a key and take this mint', () => {
    expect(
      deriveSendLockGate({
        recipientPubkey: RECIPIENT,
        nutzapProfile: declared({ mints: [MINT] }),
        nutzapLoading: false,
        selectedMintUrl: MINT,
        selectedMintNuts: P2PK_MINT,
      })
    ).toEqual({ kind: 'ready', lockKey: LOCK_KEY });
  });

  it('warns, but still offers the lock, when the key is our assumption', () => {
    expect(
      deriveSendLockGate({
        recipientPubkey: RECIPIENT,
        nutzapProfile: assumed(),
        nutzapLoading: false,
        selectedMintUrl: MINT,
        selectedMintNuts: P2PK_MINT,
      })
    ).toEqual({ kind: 'unconfirmed', lockKey: LOCK_KEY, warning: WARNING_UNCONFIRMED });
  });

  it('warns when they listed mints and this is not one of them', () => {
    // They can still claim it — the lock is to their key, not to a mint — so
    // this is a warning rather than a block.
    expect(
      deriveSendLockGate({
        recipientPubkey: RECIPIENT,
        nutzapProfile: declared({ mints: ['https://other.example'] }),
        nutzapLoading: false,
        selectedMintUrl: MINT,
        selectedMintNuts: P2PK_MINT,
      })
    ).toEqual({ kind: 'unconfirmed', lockKey: LOCK_KEY, warning: WARNING_MINT_NOT_LISTED });
  });

  it('says it is still looking rather than that locking is impossible', () => {
    const gate = deriveSendLockGate({
      recipientPubkey: RECIPIENT,
      nutzapProfile: null,
      nutzapLoading: true,
      selectedMintUrl: MINT,
      selectedMintNuts: P2PK_MINT,
    });
    expect(gate.kind).toBe('unavailable');
    expect(gate.kind === 'unavailable' && gate.reason).toMatch(/Checking/);
  });
});
