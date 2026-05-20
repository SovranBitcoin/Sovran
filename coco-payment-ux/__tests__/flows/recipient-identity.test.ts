import { describe, expect, it, vi } from 'vitest';

import { createTestMachine } from '../_harness';
import { MINT1 } from '../_harness/fixtures';
import type { RecipientProfile } from '../../src/machine/types';

const ALICE_PUBKEY = 'a'.repeat(64);
const BOB_PUBKEY = 'b'.repeat(64);

const ALICE_PROFILE: RecipientProfile = {
  displayName: 'Alice',
  avatarUrl: 'https://example.com/alice.png',
  nip05: 'alice@example.com',
};

const BOB_PROFILE: RecipientProfile = {
  displayName: 'Bob',
  avatarUrl: null,
  nip05: 'bob@example.com',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('recipient identity enrichment', () => {
  it('resolves lightning-address recipient identity in the background', async () => {
    const pubkey = deferred<string | null>();
    const profile = deferred<RecipientProfile | null>();
    const notify = vi.fn();
    const resolveRecipientPubkey = vi.fn(() => pubkey.promise);
    const resolveRecipientProfile = vi.fn(() => profile.promise);
    const tm = createTestMachine({
      operations: {
        resolveRecipientPubkey,
        resolveRecipientProfile,
      },
    });
    tm.machine.subscribe(notify);

    await tm.machine.startSendEcash({ meltTarget: 'alice@example.com' });

    tm.assertStep('enterAmount');
    tm.assertContext({
      destination: 'sendEcash',
      mintUrl: MINT1,
      meltTarget: 'alice@example.com',
    });
    expect(resolveRecipientPubkey).toHaveBeenCalledWith('alice@example.com');
    expect(resolveRecipientProfile).not.toHaveBeenCalled();

    pubkey.resolve(ALICE_PUBKEY);
    await flushAsyncWork();

    expect(resolveRecipientProfile).toHaveBeenCalledWith(ALICE_PUBKEY);
    tm.assertContext({ recipientPubkey: ALICE_PUBKEY });
    expect(tm.machine.inspect().details).toMatchObject({
      constraints: {
        recipientPubkey: ALICE_PUBKEY,
      },
    });

    profile.resolve(ALICE_PROFILE);
    await flushAsyncWork();

    tm.assertContext({
      recipientPubkey: ALICE_PUBKEY,
      recipientProfile: ALICE_PROFILE,
    });
    expect(tm.machine.inspect().details).toMatchObject({
      constraints: {
        recipientPubkey: ALICE_PUBKEY,
        recipientProfile: ALICE_PROFILE,
      },
    });
    expect(notify).toHaveBeenCalled();
  });

  it('does not overwrite a newer target with a stale pubkey result', async () => {
    const alice = deferred<string | null>();
    const bob = deferred<string | null>();
    const resolveRecipientPubkey = vi.fn((target: string) =>
      target.startsWith('alice') ? alice.promise : bob.promise
    );
    const resolveRecipientProfile = vi.fn(async (pubkey: string) =>
      pubkey === BOB_PUBKEY ? BOB_PROFILE : ALICE_PROFILE
    );
    const tm = createTestMachine({
      operations: {
        resolveRecipientPubkey,
        resolveRecipientProfile,
      },
    });

    await tm.machine.startSendEcash({ meltTarget: 'alice@example.com' });
    await tm.machine.startSendEcash({ reset: true, meltTarget: 'bob@example.com' });

    alice.resolve(ALICE_PUBKEY);
    await flushAsyncWork();

    expect(tm.machine.getContext().recipientPubkey).toBeUndefined();
    expect(resolveRecipientProfile).not.toHaveBeenCalled();

    bob.resolve(BOB_PUBKEY);
    await flushAsyncWork();

    tm.assertContext({
      meltTarget: 'bob@example.com',
      recipientPubkey: BOB_PUBKEY,
      recipientProfile: BOB_PROFILE,
    });
    expect(resolveRecipientProfile).toHaveBeenCalledWith(BOB_PUBKEY);
  });

  it('skips pubkey lookup when the flow already has a recipient pubkey', async () => {
    const resolveRecipientPubkey = vi.fn(async () => ALICE_PUBKEY);
    const resolveRecipientProfile = vi.fn(async () => ALICE_PROFILE);
    const tm = createTestMachine({
      operations: {
        resolveRecipientPubkey,
        resolveRecipientProfile,
      },
    });

    await tm.machine.startSendEcash({
      meltTarget: 'alice@example.com',
      recipientPubkey: ALICE_PUBKEY,
    });
    await flushAsyncWork();

    expect(resolveRecipientPubkey).not.toHaveBeenCalled();
    expect(resolveRecipientProfile).toHaveBeenCalledWith(ALICE_PUBKEY);
    tm.assertContext({
      recipientPubkey: ALICE_PUBKEY,
      recipientProfile: ALICE_PROFILE,
    });
    expect(tm.machine.inspect().details).toMatchObject({
      constraints: {
        recipientPubkey: ALICE_PUBKEY,
        recipientProfile: ALICE_PROFILE,
      },
    });
  });
});
