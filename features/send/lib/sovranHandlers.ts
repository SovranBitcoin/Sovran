/**
 * @fileoverview Sovran payment-machine step handlers for colada.
 *
 * createSovranHandlers maps colada step codes to Sovran behavior: navigation,
 * popups, dismissals, Near Pay / Routstr / NFC delivery, scan-history + location
 * stamping, and transaction-annotation linking. Sibling concerns live in
 * sovranNotifications, sovranScreenActions, sovranScanSources, and
 * sovranPaymentOperations.
 */

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { paymentLog } from '@/shared/lib/logger';
import { mintUrlLogFields } from './sovranPaymentLog';
import { mintLocalId } from '@/shared/lib/id';

import { getEncodedToken } from '@cashu/cashu-ts';
import type { HistoryEntry, Manager, MeltHistoryEntry } from '@cashu/coco-core';
import { type PaymentMachine, type StepHandlerMap } from '@sovranbitcoin/colada';

import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { resolvePrimaryReceiveP2PKPublicKey } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import {
  paymentFallbackPopup,
  paymentOptionsPopup,
  proofSelectorPopup,
  sendMemoPopup,
  staticPopup,
  paramPopup,
} from '@/shared/lib/popup';
import { executeRoutstrTopUp, formatRoutstrBalance } from '@/shared/lib/routstr/topUp';
import { sendBLEPrivateMessageWhole } from '@/features/bitchat/lib/blePrivateDelivery';
import { getBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { getBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import type { BitchatBLEIdentityMaterial } from 'bitchat-module';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { getNpcAddress } from '@/shared/lib/cashu/npc';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { useSendReachabilityStore } from '@/shared/stores/profile/sendReachabilityStore';

// =============================================================================
// createSovranHandlers
// =============================================================================

interface CreateSovranHandlersConfig {
  machine: PaymentMachine;
  onOptionDismiss?: () => void;
  getManager: () => Manager | null;
  getNpub?: () => string | undefined;
  getBitchatIdentityMaterial?: () => BitchatBLEIdentityMaterial | null;
}

function getEncodedEcashTokenFromSendHistoryEntry(historyEntry: string): string | null {
  try {
    const parsed = JSON.parse(historyEntry) as {
      token?: Parameters<typeof getEncodedToken>[0];
      tokenString?: unknown;
      metadata?: { rawToken?: unknown };
    };
    if (typeof parsed.tokenString === 'string' && parsed.tokenString.length > 0) {
      return parsed.tokenString;
    }
    if (typeof parsed.metadata?.rawToken === 'string' && parsed.metadata.rawToken.length > 0) {
      return parsed.metadata.rawToken;
    }
    if (parsed.token) {
      return getEncodedToken(parsed.token);
    }
  } catch (err) {
    paymentLog.warn('near_pay.token.extract_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

async function deliverNearPayIfActive(
  historyEntry: string,
  getBitchatIdentityMaterial?: () => BitchatBLEIdentityMaterial | null
): Promise<void> {
  const active = useNearPaySessionStore.getState().active;
  if (!active) return;

  // Every Nut Drop send is delivered as a SINGLE private Noise DM to a
  // creq-confirmed Sovran peer — encrypted to them, so a locked OR offline
  // bearer token stays private (no public-mesh broadcast of payment metadata).
  // The whole multi-KB token fits one message thanks to the extended
  // PrivateMessagePacket length. Stock clients can't decode extended DMs, so
  // active sessions must carry a creq capability proof before we transmit.

  try {
    const encodedToken = getEncodedEcashTokenFromSendHistoryEntry(historyEntry);
    if (!encodedToken) throw new Error('Created send entry did not contain an ecash token');
    if (!active.recipient.creq) {
      throw new Error('Nut Drop recipient has not advertised a creq capability');
    }

    const profileScope = getBitchatProfileScope();
    const identityMaterial = getBitchatIdentityMaterial?.() ?? null;
    const nickname = getBitchatNickname() || 'sovran';
    const result = await sendBLEPrivateMessageWhole({
      peerID: active.recipient.peerID,
      content: encodedToken,
      nickname,
      profileScope,
      identityMaterial,
    });

    paymentLog.info('near_pay.delivery.sent', {
      peerID: active.recipient.peerID,
      tokenBytes: encodedToken.length,
      hasDirectLink: active.recipient.hasDirectLink,
      startupMs: Math.round(result.startupMs * 100) / 100,
      handshakeMs: Math.round(result.handshakeMs * 100) / 100,
      sendMs: Math.round(result.sendMs * 100) / 100,
      ...(result.handshakeError ? { handshakeError: result.handshakeError } : {}),
    });

    // Delivered over the BLE/bitchat mesh — stamp a bluetooth source badge on
    // the resulting send transaction.
    try {
      const entry = JSON.parse(historyEntry) as { id?: unknown };
      if (typeof entry.id === 'string') {
        setTransactionAnnotation(`id:${entry.id}`, { scan: { method: 'ble' } });
      }
    } catch (e) {
      paymentLog.warn('near_pay.delivery.ble_source_annotation_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (err) {
    paymentLog.error('near_pay.delivery.failed', {
      peerID: active.recipient.peerID,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    useNearPaySessionStore.getState().complete();
  }
}

export function createSovranHandlers({
  machine,
  onOptionDismiss,
  getManager,
  getNpub,
  getBitchatIdentityMaterial,
}: CreateSovranHandlersConfig): StepHandlerMap {
  paymentLog.debug('payment.handlers.created');

  return {
    receiveToken: ({ token }) => {
      paymentLog.info('payment.step.receive_token');
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    sendComplete: async ({
      historyEntry,
      createdOffline,
      mintWasOffline,
      recipientPubkey,
      recipientProfile,
      p2pkLockPubkey,
    }) => {
      paymentLog.info('payment.step.send_complete', {
        createdOffline: !!createdOffline,
        mintWasOffline: !!mintWasOffline,
        recipientPubkeyPresent: !!recipientPubkey,
        p2pkLocked: !!p2pkLockPubkey,
      });

      // Routstr top-up: intercept the token and send it to the Routstr API
      const topUpState = useRoutstrTopUpStore.getState();
      if (topUpState.active) {
        try {
          const entry = JSON.parse(historyEntry);
          const encodedToken = getEncodedToken(entry.token);
          const result = await executeRoutstrTopUp(encodedToken);

          if (result.success) {
            const balanceStr = formatRoutstrBalance(result.balance);
            if (result.isNewWallet) {
              paramPopup('routstr-wallet-created', { balance: balanceStr });
            } else {
              paramPopup('routstr-top-up-success', { balance: balanceStr });
            }
            useRoutstrTopUpStore.getState().complete('success');
          } else {
            staticPopup('routstr-transaction-failed', { text: result.error });
            useRoutstrTopUpStore.getState().complete('failed');
          }
        } catch (e) {
          paymentLog.error('payment.routstr_topup.error', {
            error: e instanceof Error ? e.message : String(e),
          });
          staticPopup('routstr-transaction-failed', { text: 'Failed to process top-up' });
          useRoutstrTopUpStore.getState().complete('failed');
        }
        router.dismiss();
        return;
      }

      // Inject recipientPubkey into the executed history entry's metadata
      // so SendTokenScreen can render the recipient identity. Operations
      // build the entry; we attach identity at the screen-handler seam.
      const enrichedHistoryEntry = recipientPubkey
        ? injectRecipientPubkey(historyEntry, recipientPubkey)
        : historyEntry;

      // Persist the recipient's nostr identity as a counterparty annotation so
      // the transactions row + detail show their avatar (the transient
      // metadata injection above only survives this navigation).
      if (recipientPubkey) {
        try {
          const entry = JSON.parse(enrichedHistoryEntry) as { id?: unknown };
          if (typeof entry.id === 'string') {
            setTransactionAnnotation(`id:${entry.id}`, {
              counterparty: {
                pubkey: recipientPubkey,
                direction: 'recipient',
                ...(recipientProfile?.displayName
                  ? { displayName: recipientProfile.displayName }
                  : {}),
                ...(recipientProfile?.avatarUrl ? { avatarUrl: recipientProfile.avatarUrl } : {}),
                ...(recipientProfile?.nip05 ? { nip05: recipientProfile.nip05 } : {}),
              },
            });
          }
        } catch (e) {
          paymentLog.warn('payment.send_complete.counterparty_annotation_failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (createdOffline) {
        try {
          const entry = JSON.parse(enrichedHistoryEntry) as { id?: unknown; mintUrl?: unknown };
          if (typeof entry.id === 'string' && typeof entry.mintUrl === 'string') {
            useSendReachabilityStore.getState().markChecking(entry.id, entry.mintUrl);
            useSendReachabilityStore.getState().pruneOld();
          }
        } catch (e) {
          paymentLog.warn('payment.send_complete.reachability_seed_failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      await deliverNearPayIfActive(enrichedHistoryEntry, getBitchatIdentityMaterial);

      router.navigate({
        pathname: '/(send-flow)/sendToken',
        params: {
          sendHistoryEntry: enrichedHistoryEntry,
          ...(createdOffline ? { createdOffline: 'true' } : {}),
          ...(mintWasOffline ? { mintWasOffline: 'true' } : {}),
        },
      });
    },

    navigateToPaymentRequest: ({ mintUrl, paymentRequest, amount, unit, recipientPubkey }) => {
      paymentLog.info('payment.step.navigate_payment_request', {
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        recipientPubkeyPresent: !!recipientPubkey,
        paymentRequestLength: paymentRequest.length,
      });
      const entry = {
        id: mintLocalId('pr-preview'),
        type: 'send',
        createdAt: Date.now(),
        mintUrl,
        amount,
        unit,
        state: 'prepared',
        metadata: {
          paymentRequest,
          phase: 'preview',
          ...(recipientPubkey ? { recipientPubkey } : {}),
        },
      };
      const isFallback = (machine.getContext().failedOptionValues?.length ?? 0) > 0;
      const nav = isFallback ? router.replace : router.navigate;
      nav({
        pathname: '/(send-flow)/paymentRequest',
        params: { paymentRequestEntry: JSON.stringify(entry) },
      });
    },

    navigateToMeltPreview: ({
      mintUrl,
      meltTarget,
      amount,
      unit,
      recipientPubkey,
      recipientProfile,
    }) => {
      paymentLog.info('payment.step.navigate_melt_preview', {
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        meltTargetLength: meltTarget.length,
        recipientPubkeyPresent: !!recipientPubkey,
        recipientProfilePresent: !!recipientProfile,
        recipientProfileDisplayName: recipientProfile?.displayName ?? null,
        recipientProfileAvatarUrlPresent: !!recipientProfile?.avatarUrl,
      });
      // `MeltHistoryEntry.metadata` is typed `Record<string, string>` upstream
      // in `@cashu/coco-core`, so the resolved profile is flattened into
      // individual string keys instead of stored as a nested object.
      // `LightningSendScreen` re-assembles them on read.
      const id = mintLocalId('melt-preview');
      const now = Date.now();
      const entry: MeltHistoryEntry & {
        source: 'legacy';
        legacyHistoryId: string;
        updatedAt: number;
      } = {
        id,
        type: 'melt',
        source: 'legacy',
        legacyHistoryId: id,
        createdAt: now,
        updatedAt: now,
        mintUrl,
        unit: unit ?? 'sat',
        quoteId: '',
        state: 'UNPAID',
        amount: amountToNumber(amount),
        metadata: {
          phase: 'preview',
          meltTarget,
          ...(recipientPubkey ? { recipientPubkey } : {}),
          ...(recipientProfile?.displayName
            ? { recipientDisplayName: recipientProfile.displayName }
            : {}),
          ...(recipientProfile?.avatarUrl
            ? { recipientAvatarUrl: recipientProfile.avatarUrl }
            : {}),
          ...(recipientProfile?.nip05 ? { recipientNip05: recipientProfile.nip05 } : {}),
        },
      };
      const isFallback = (machine.getContext().failedOptionValues?.length ?? 0) > 0;
      const nav = isFallback ? router.replace : router.navigate;
      nav({
        pathname: '/(send-flow)/lightningSend',
        params: { meltHistoryEntry: JSON.stringify(entry) },
      });
    },

    mintQuoteCreated: ({ historyEntry, unit }) => {
      let pathname: '/(receive-flow)/lightningReceive' | '/(receive-flow)/onchainReceive' =
        '/(receive-flow)/lightningReceive';
      try {
        pathname = getOnchainMintAddress(JSON.parse(historyEntry) as HistoryEntry)
          ? '/(receive-flow)/onchainReceive'
          : '/(receive-flow)/lightningReceive';
      } catch {
        pathname = '/(receive-flow)/lightningReceive';
      }
      router.replace({
        pathname,
        params: { mintHistoryEntry: historyEntry, unit },
      });
    },

    reviewMint: ({ mintUrl, token, mintInfo }) => {
      const entry = {
        ...(mintInfo ?? {}),
        mintUrl,
        fromAccepter: true,
        token,
      };
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintInfoEntry: JSON.stringify(entry) },
      });
    },

    openMint: ({ url, mintInfo }) => {
      const entry = {
        ...(mintInfo ?? {}),
        mintUrl: url,
        fromScan: true,
      };
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintInfoEntry: JSON.stringify(entry) },
      });
    },

    openProfile: ({ npub }) => {
      router.navigate(buildModalProfileHref({ npub }));
    },

    navigateToReceive: async ({ unit, methodContext }) => {
      const t0 = performance.now();
      const npub = getNpub?.();
      const selectedMintUrl = useNpcMintStore.getState().getActiveMintUrl();

      let p2pkKey: string | undefined;
      const currentMgr = getManager();
      if (currentMgr) {
        try {
          p2pkKey = await resolvePrimaryReceiveP2PKPublicKey(currentMgr);
        } catch {
          /* ignore */
        }
      }

      const entry = {
        type: 'receive',
        id: 'receive-hub',
        createdAt: Date.now(),
        mintUrl: selectedMintUrl ?? '',
        npcAddress: npub ? getNpcAddress(undefined, npub) : undefined,
        p2pkKey,
        selectedMintUrl,
        ...(methodContext ? { methodContext } : {}),
        unit,
      };
      router.navigate({
        pathname: '/(receive-flow)/receive',
        params: { receiveEntry: JSON.stringify(entry), unit },
      });
      paymentLog.info('navigate.receive.done', { duration_ms: performance.now() - t0 });
    },

    enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
      const t0 = performance.now();
      const entry = {
        destination: constraints.destination,
        unit,
        selectedMintUrl: preselectedMintUrl ?? '',
        ...(constraints.paymentRequest ? { paymentRequest: constraints.paymentRequest } : {}),
        ...(constraints.meltTarget ? { meltTarget: constraints.meltTarget } : {}),
        ...(constraints.methodContext ? { methodContext: constraints.methodContext } : {}),
        // Snapshot the machine-resolved recipient identity onto the entry so
        // the amount screen renders "Pay <name>" + avatar on first paint
        // when the resolver beat the navigation. AmountFlowScreen also
        // subscribes to the live ctx for the case where the resolver lands
        // after navigation.
        ...(constraints.recipientPubkey ? { recipientPubkey: constraints.recipientPubkey } : {}),
        ...(constraints.recipientProfile ? { recipientProfile: constraints.recipientProfile } : {}),
      };
      const params = { amountEntry: JSON.stringify(entry) };
      const nearPaySessionStore = useNearPaySessionStore.getState();
      // Radar-launched sends stay inline on the radar: the vanilla ladder
      // arrives as destination 'sendEcash', mesh sends as 'paymentRequest'
      // (the solicited creq rides the payment-request machinery).
      if (
        nearPaySessionStore.active &&
        (constraints.destination === 'sendEcash' || constraints.destination === 'paymentRequest')
      ) {
        nearPaySessionStore.setAmountEntry(params.amountEntry);
        paymentLog.info('navigate.enterAmount.near_pay_inline', {
          destination: constraints.destination,
          duration_ms: performance.now() - t0,
        });
        return;
      }
      router.navigate(
        constraints.destination === 'mintQuote'
          ? { pathname: '/(receive-flow)/amount', params }
          : { pathname: '/(send-flow)/amount', params }
      );
      paymentLog.info('navigate.enterAmount.done', { duration_ms: performance.now() - t0 });
    },

    selectMint: ({
      candidates: _candidates,
      supportedMintUrls: _supportedMintUrls,
      amount: _amount,
      unit,
      paymentRequest: _paymentRequest,
      meltTarget: _meltTarget,
      destination,
      mintQuoteMethod,
      meltQuoteMethod,
      methodRequirement,
      mintListItems,
      scope,
    }) => {
      const entry = {
        items: mintListItems ?? [],
        scope: scope ?? 'selected',
        destination,
        ...(mintQuoteMethod ? { mintQuoteMethod } : {}),
        ...(meltQuoteMethod ? { meltQuoteMethod } : {}),
        ...(methodRequirement ? { methodRequirement } : {}),
        unit,
      };

      const params = { mintSelectorEntry: JSON.stringify(entry) };
      router.navigate(
        destination === 'mintQuote' || scope === 'npc'
          ? { pathname: '/(receive-flow)/mintSelect', params }
          : { pathname: '/(send-flow)/mintSelect', params }
      );
    },

    chooseOption: (stepData) => {
      paymentOptionsPopup({ ...stepData, machine, onDismiss: onOptionDismiss });
    },

    chooseFallbackOption: (stepData) => {
      paymentFallbackPopup({ ...stepData, machine, onDismiss: onOptionDismiss });
    },

    chooseProofs: (stepData) => {
      proofSelectorPopup({ ...stepData, machine });
    },

    enterSendMemo: (stepData) => {
      sendMemoPopup({ ...stepData, machine });
    },

    dismiss: () => {
      router.back();
    },
  };
}

/**
 * Re-serialize a JSON-encoded coco history entry with `recipientPubkey`
 * added to its metadata. Returns the input unchanged if it can't be parsed
 * — operations build the entry, this only attaches identity at the seam.
 */
function injectRecipientPubkey(historyEntry: string, recipientPubkey: string): string {
  try {
    const parsed = JSON.parse(historyEntry) as { metadata?: Record<string, unknown> };
    parsed.metadata = { ...(parsed.metadata ?? {}), recipientPubkey };
    return JSON.stringify(parsed);
  } catch {
    paymentLog.warn('payment.recipient_pubkey.inject_failed');
    return historyEntry;
  }
}
