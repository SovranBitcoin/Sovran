/**
 * The amount screen's lock: what the header shows, what the sheet asks, and
 * what the send is told.
 *
 * One owner for every flow, so a lock is always announced the same way. The
 * header icon says whether the ecash about to be created is locked. The sheet
 * names who it is locked to and asks for how long. And a locked send never
 * leaves without that sheet having been answered — by tapping the icon
 * beforehand, or when Next is pressed.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { P2pkLockSpec } from 'wallet';

import type { MintNuts } from '@/shared/lib/cashu/mintNuts';
import { paymentLog } from '@/shared/lib/logger';
import { acknowledgeSheet } from '@/shared/lib/popup/popups/acknowledgeSheet';
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
  /** The header icon's tap: the sheet, or the reason there is none. */
  open: () => void;
  /**
   * What an unlocked send tells the machine: `null` when locking was the
   * sender's to choose and they left it off, so no lock may stand by default;
   * `undefined` when the screen has nothing to say. The terms of a LOCKED send
   * never travel this way — they come from `confirmLock`, as the send leaves.
   */
  lockChoice: null | undefined;
  /** Drives the "Lock Ecash" row of the payment-method menu. */
  lockOption: { reason?: string; choose: LockChooser } | undefined;
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
}

const LOCK_ICON = 'mdi:lock-outline';

export function useSendLock(params: UseSendLockParams): SendLock {
  const { entry, recipientPubkey, recipientName, selectedMintUrl, selectedMintNuts } = params;
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

  const choose = useCallback(
    (allowOff: boolean): Promise<P2pkLockSpec | null> => {
      if (mode.mode !== 'optional' && mode.mode !== 'required') return Promise.resolve(null);
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
          onDismiss: () => resolve(null),
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

  const explain = useCallback(
    (reason: string) => {
      void acknowledgeSheet({
        title: mode.mode === 'request' && mode.locked ? 'Locked by the request' : 'Not locked',
        testID: 'amount-lock-notice-ok',
        description: reason,
        icon: mode.mode === 'request' && mode.locked ? LOCK_ICON : 'mdi:lock-open-variant-outline',
      });
    },
    [mode]
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
          open: () => {},
          lockChoice: undefined,
          lockOption: undefined,
          confirmLock: undefined,
        };
      case 'request':
        return {
          mode: 'request',
          locked: mode.locked,
          label: mode.locked ? 'Locked by the payment request' : 'Not locked',
          open: () => explain(mode.reason),
          lockChoice: undefined,
          lockOption: undefined,
          confirmLock: undefined,
        };
      case 'unavailable':
        return {
          mode: 'unavailable',
          locked: false,
          label: `Not locked. ${mode.reason}`,
          open: () => explain(mode.reason),
          // A send to a person still says "no lock" out loud, so a lock the
          // flow started with cannot stand by default.
          lockChoice: mode.hasRecipient ? null : undefined,
          lockOption: mode.hasRecipient
            ? { reason: mode.reason, choose: () => Promise.resolve(null) }
            : undefined,
          confirmLock: undefined,
        };
      case 'required':
        return {
          mode: 'required',
          locked: true,
          label: `Locked to ${recipientName}. Change how long`,
          open: () => void choose(false),
          lockChoice: undefined,
          lockOption: undefined,
          confirmLock: confirm,
        };
      case 'optional':
        return {
          mode: 'optional',
          locked: hasChoice,
          label: hasChoice
            ? `Locked to ${recipientName}. Change lock`
            : `Not locked. Lock to ${recipientName}`,
          open: () => void choose(true),
          lockChoice: hasChoice ? undefined : null,
          // Already answered from the header: the row sends on those terms
          // rather than asking the same question twice.
          lockOption: { choose: confirm },
          confirmLock: hasChoice ? confirm : undefined,
        };
    }
  }, [mode, choice, choose, explain, recipientName]);
}
