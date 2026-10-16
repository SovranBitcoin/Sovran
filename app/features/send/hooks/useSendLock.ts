/**
 * The amount screen's lock: what the header shows, what the sheet asks, and
 * what the send is told.
 *
 * One owner for every flow, so a lock is always announced the same way. The
 * header icon is status only: whether the ecash about to be created is
 * locked. The question comes as the ecash leaves: "as Ecash" asks "Lock to
 * <name>" (or "Don't lock") when online, and a required lock asks only for
 * how long. Offline there is nothing to ask — a lock needs a swap at the mint.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { P2pkLockSpec } from 'wallet';

import type { MintNuts } from '@/shared/lib/cashu/mintNuts';
import { paymentLog } from '@/shared/lib/logger';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { useSendLockStore } from '@/shared/stores/runtime/sendLockStore';

import { seededLockKey } from '../lib/p2pkLock';
import {
  choiceMatchesMode,
  deriveSendLockMode,
  lockSpecForChoice,
  type SendLockMode,
} from '../lib/sendLockControl';
import {
  buildSendLockMenuItems,
  type SendLockDurationId,
  type SendLockDurationOption,
} from '../lib/sendLockMenu';
import { useSendLockTarget } from './useSendLockTarget';

type LockChooser = () => Promise<P2pkLockSpec | null>;

interface SendLock {
  mode: SendLockMode['mode'];
  /** Whether the ecash about to be created will be locked. */
  locked: boolean;
  /** What the header icon says to a screen reader. */
  label: string;
  /**
   * What an unlocked send tells the machine: `null` when locking was the
   * sender's to choose and they left it off, so no lock may stand by default;
   * `undefined` when the screen has nothing to say. The terms of a LOCKED send
   * never travel this way — they come from `confirmLock`, as the send leaves.
   */
  lockChoice: null | undefined;
  /**
   * Set when locking is the sender's to choose and it can happen now (online):
   * "as Ecash" asks "Lock to <name>" first. Resolves the lock, `null` for
   * "Don't lock", or `undefined` when the sender backed out and nothing may
   * be sent.
   */
  askLock: (() => Promise<P2pkLockSpec | null | undefined>) | undefined;
  /**
   * Set whenever the send will be locked. Called as the send leaves: it
   * returns the terms as of that moment, asking first if the sheet has not
   * been answered yet. Resolves null when the sender backs out, and the send
   * must then not go.
   */
  confirmLock: LockChooser | undefined;
}

interface UseSendLockParams {
  entry: Record<string, unknown> | null | undefined;
  recipientPubkey?: string;
  /** Who the sheet names. */
  recipientName: string;
  selectedMintUrl?: string;
  selectedMintNuts?: MintNuts;
  /** No network: a lock cannot be made, so an optional one is never asked for. */
  offline?: boolean;
}

export function useSendLock(params: UseSendLockParams): SendLock {
  const { entry, recipientPubkey, recipientName, selectedMintUrl, selectedMintNuts, offline } =
    params;
  const draft = useSendLockStore((state) => state.draft);
  const setDraft = useSendLockStore((state) => state.set);
  const clearDraft = useSendLockStore((state) => state.clear);

  const { gate, refundKey } = useSendLockTarget({
    ...(recipientPubkey ? { recipientPubkey } : {}),
    ...(selectedMintUrl ? { selectedMintUrl } : {}),
    ...(selectedMintNuts ? { selectedMintNuts } : {}),
  });

  const destination = typeof entry?.destination === 'string' ? entry.destination : undefined;
  const seededKey = seededLockKey(entry);
  const requestLockKey =
    typeof entry?.paymentRequestLockPubkey === 'string' && entry.paymentRequestLockPubkey.length > 0
      ? entry.paymentRequestLockPubkey
      : null;
  const mode = useMemo(
    () =>
      deriveSendLockMode({
        ...(destination ? { destination } : {}),
        seededLockKey: seededKey,
        requestLockKey,
        ...(recipientPubkey ? { recipientPubkey } : {}),
        gate,
      }),
    [destination, seededKey, requestLockKey, recipientPubkey, gate]
  );

  // A choice that outlived its key would lock this payment on terms chosen
  // for another. Drop it rather than carry it.
  const choice = choiceMatchesMode(draft, mode) ? draft : null;
  useEffect(() => {
    if (draft && !choiceMatchesMode(draft, mode)) clearDraft();
  }, [draft, mode, clearDraft]);

  // Resolves the lock, `null` for "Don't lock", `undefined` when dismissed.
  const ask = useCallback(
    (allowOff: boolean): Promise<P2pkLockSpec | null | undefined> => {
      if (mode.mode !== 'optional' && mode.mode !== 'required') return Promise.resolve(undefined);
      const lockKey = mode.lockKey;
      const confirmed = mode.mode === 'required' || mode.confirmed;
      const current: SendLockDurationId | null = choice
        ? (choice.durationId as SendLockDurationId)
        : allowOff
          ? 'off'
          : null;
      return new Promise((resolve) =>
        actionMenuSheet({
          title: `Lock to ${recipientName}`,
          onDismiss: () => resolve(undefined),
          buttons: buildSendLockMenuItems({
            recipientName,
            current,
            allowOff,
            hasRefundKey: !!refundKey,
            nowMs: Date.now(),
            onPick: (option: SendLockDurationOption) => {
              paymentLog.info('send.lock.chosen', { durationId: option.id, mode: mode.mode });
              if (option.id === 'off') {
                clearDraft();
                resolve(null);
                return;
              }
              const next = {
                lockKey,
                durationId: option.id,
                // Kept only for a timed choice: NUT-11 refuses a refund key
                // without a locktime, and the permanent lock has neither.
                ...(option.offsetSec !== null && refundKey ? { refundKey } : {}),
              };
              setDraft({
                ...next,
                ...(recipientPubkey ? { recipientPubkey } : {}),
                confirmed,
              });
              resolve(lockSpecForChoice(next, Date.now()));
            },
          }),
        })
      );
    },
    [mode, choice, recipientName, recipientPubkey, refundKey, setDraft, clearDraft]
  );
  const choose = useCallback(
    async (allowOff: boolean): Promise<P2pkLockSpec | null> => (await ask(allowOff)) ?? null,
    [ask]
  );

  return useMemo<SendLock>(() => {
    // Whether the kept choice can be honoured at all; the clock plays no part
    // in that, so render never reads it.
    const hasChoice = !!choice && lockSpecForChoice(choice, 0) !== null;
    const chosenSpec = (): P2pkLockSpec | null =>
      choice ? lockSpecForChoice(choice, Date.now()) : null;
    // Worked out as the send leaves, so "reclaim after 1 hour" counts from
    // the send and not from when the sheet was answered.
    const confirm: LockChooser = () => {
      const spec = chosenSpec();
      return spec ? Promise.resolve(spec) : choose(false);
    };

    switch (mode.mode) {
      case 'hidden':
        return {
          mode: 'hidden',
          locked: false,
          label: '',
          lockChoice: undefined,
          confirmLock: undefined,
          askLock: undefined,
        };
      case 'request':
        return {
          mode: 'request',
          locked: mode.locked,
          label: mode.locked ? 'Locked by the payment request' : 'Not locked',
          lockChoice: undefined,
          confirmLock: undefined,
          askLock: undefined,
        };
      case 'unavailable':
        return {
          mode: 'unavailable',
          locked: false,
          label: `Not locked. ${mode.reason}`,
          // A send to a person still says "no lock" out loud, so a lock the
          // flow started with cannot stand by default.
          lockChoice: mode.hasRecipient ? null : undefined,
          confirmLock: undefined,
          askLock: undefined,
        };
      case 'required':
        return {
          mode: 'required',
          locked: true,
          label: `Locked to ${recipientName}`,
          lockChoice: undefined,
          confirmLock: confirm,
          askLock: undefined,
        };
      case 'optional':
        return {
          mode: 'optional',
          locked: hasChoice && !offline,
          label: hasChoice && !offline ? `Locked to ${recipientName}` : 'Not locked',
          lockChoice: hasChoice && !offline ? undefined : null,
          // Offline a lock cannot be made, so the ecash leaves unlocked rather
          // than failing on a choice made while online.
          confirmLock: hasChoice && !offline ? confirm : undefined,
          askLock: offline ? undefined : () => ask(true),
        };
    }
  }, [mode, choice, choose, ask, recipientName, offline]);
}
