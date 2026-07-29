/**
 * @fileoverview Zap orchestrator — pays a nostr post from the cashu wallet.
 *
 * Both paths out of the zap menu ({@link openZapMenu}) confirm on the
 * existing melt preview screen (LightningSendScreen) — tapping Pay there is
 * the confirmation step:
 *
 * 1. Preset tap → `machine.enterAmount` with the preset sats and a fresh
 *    `meltQuote` destination → melt preview prefilled with amount +
 *    recipient → Pay.
 * 2. "Custom amount…" → `machine.startSendEcash` → amount screen → melt
 *    preview → Pay.
 *
 * The pending-zap registry carries the post context: the Colada provider's
 * `getLnurlPayExtras` attaches the signed 9734 during the LNURL invoice
 * fetch, and LightningSendScreen writes the zap annotation once the quote
 * exists and records the durable zapped state when the melt is paid.
 *
 * Recipient resolution mirrors UserProfileScreen.handleSendMoney: validated
 * lud16 from the cached kind-0, else the npub.cash fallback address. Targets
 * whose LNURL server lacks `allowsNostr` still get paid — as a plain
 * lightning send, annotated `receiptKind: 'plain'`.
 */

import { useCallback } from 'react';
import { nip19 } from 'nostr-tools';
import { LightningAddress } from '@sovranbitcoin/schemas';
import { usePaymentFlowMachine } from 'wallet/react';

import { resolveIdentityName } from '@/shared/lib/identity';
import { paymentLog } from '@/shared/lib/logger';
import { getNpcAddress } from '@/shared/lib/cashu/npc';
import { readProfileRecord } from '@/shared/lib/nostr/useEntityCache';
import { paramPopup } from '@/shared/lib/popup';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { registerPendingZap } from '@/shared/stores/runtime/pendingZapStore';

import type { FeedEvent } from '../components/nostr/feedTypes';
import { openZapMenu as openZapMenuPopup } from '../lib/zapMenu';
import { zapContentPreview, type ZapPreset } from '../lib/zapPresets';

interface ZapTarget {
  meltTarget: string;
  displayName: string;
  avatarUrl?: string;
  nip05?: string;
}

function resolveZapTarget(event: FeedEvent): ZapTarget | null {
  const profile = readProfileRecord(event.pubkey);
  const displayName = resolveIdentityName({ pubkey: event.pubkey, nostrProfile: profile });
  // lud16 from a relay is untrusted input — always re-validate before use.
  const rawLud16 = profile?.lud16;
  const lud16 =
    rawLud16 && LightningAddress.safeParse(rawLud16).success ? rawLud16.toLowerCase() : undefined;
  let npcFallback: string | undefined;
  if (!lud16) {
    try {
      npcFallback = getNpcAddress(undefined, nip19.npubEncode(event.pubkey));
    } catch {
      npcFallback = undefined;
    }
  }
  const meltTarget = lud16 ?? npcFallback;
  if (!meltTarget) return null;
  return {
    meltTarget,
    displayName,
    avatarUrl: profile?.picture,
    nip05: profile?.nip05,
  };
}

function showZapUnavailable(): void {
  paramPopup('action-unavailable', {
    title: "Can't zap",
    message: 'This author has no Lightning address.',
  });
}

export function useZap() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const startPresetZap = useCallback(
    async (event: FeedEvent, preset: ZapPreset, baseSats: number) => {
      const target = resolveZapTarget(event);
      if (!target) {
        showZapUnavailable();
        return;
      }
      const mintUrl = useMintStore.getState().selectedMint;
      if (!mintUrl) {
        paramPopup('action-unavailable', {
          title: "Can't zap",
          message: 'Add a mint with some sats first.',
        });
        return;
      }
      // Root-entry clear FIRST (it evicts pending zaps), then register.
      clearPaymentContext('feed.zap_post');
      registerPendingZap({
        meltTarget: target.meltTarget,
        eventId: event.id,
        eventKind: event.kind,
        authorPubkey: event.pubkey,
        authorName: target.displayName,
        authorAvatarUrl: target.avatarUrl,
        contentPreview: zapContentPreview(event.content),
        emoji: preset.emoji,
        comment: preset.message,
        presetSats: preset.sats,
        baseSats,
        createdAt: Date.now(),
      });
      paymentLog.info('feed.zap.preset_start', {
        eventIdPrefix: event.id.slice(0, 8),
        presetSats: preset.sats,
        meltTargetLength: target.meltTarget.length,
      });
      try {
        // Fresh `meltQuote` destination resets any stale flow context and
        // routes straight to the melt preview (the confirmation step). On a
        // fiat active unit the machine bounces to the amount screen instead —
        // recipient constraints survive, the user just types the amount.
        await machine.enterAmount({ value: preset.sats, unit: 'sat' }, mintUrl, {
          destination: 'meltQuote',
          meltQuoteMethod: 'bolt11',
          meltTarget: target.meltTarget,
          recipientPubkey: event.pubkey,
          recipientProfile: {
            displayName: target.displayName,
            avatarUrl: target.avatarUrl ?? null,
            nip05: target.nip05 ?? null,
          },
        });
      } catch (error) {
        paymentLog.warn('feed.zap.preset_failed_to_start', {
          eventIdPrefix: event.id.slice(0, 8),
          presetSats: preset.sats,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [machine]
  );

  const startCustomZap = useCallback(
    async (event: FeedEvent, baseSats: number) => {
      const target = resolveZapTarget(event);
      if (!target) {
        showZapUnavailable();
        return;
      }
      // Root-entry clear FIRST (it evicts pending zaps), then register.
      clearPaymentContext('feed.zap_post');
      registerPendingZap({
        meltTarget: target.meltTarget,
        eventId: event.id,
        eventKind: event.kind,
        authorPubkey: event.pubkey,
        authorName: target.displayName,
        authorAvatarUrl: target.avatarUrl,
        contentPreview: zapContentPreview(event.content),
        emoji: '⚡',
        comment: '',
        baseSats,
        createdAt: Date.now(),
      });
      paymentLog.info('feed.zap.custom_start', {
        eventIdPrefix: event.id.slice(0, 8),
        meltTargetLength: target.meltTarget.length,
      });
      try {
        await machine.startSendEcash({
          reset: true,
          meltTarget: target.meltTarget,
          recipientPubkey: event.pubkey,
          recipientProfile: {
            displayName: target.displayName,
            avatarUrl: target.avatarUrl ?? null,
            nip05: target.nip05 ?? null,
          },
        });
      } catch (error) {
        paymentLog.warn('feed.zap.custom_failed_to_start', {
          eventIdPrefix: event.id.slice(0, 8),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [machine]
  );

  /** Open the zap chooser for a post. `baseSats` = the post's current satsZapped. */
  const openZapMenu = useCallback(
    (event: FeedEvent, baseSats: number) => {
      openZapMenuPopup({
        onPreset: (preset) => void startPresetZap(event, preset, baseSats),
        onCustom: () => void startCustomZap(event, baseSats),
      });
    },
    [startPresetZap, startCustomZap]
  );

  return { openZapMenu };
}
