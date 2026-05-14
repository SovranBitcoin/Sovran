// ---------------------------------------------------------------------------
// Default Screen Action Handlers — batteries-included implementations
//
// These handlers use operations for async work and notifications for UI
// feedback. Wallets get working screen actions out of the box — only
// truly app-specific actions (NFC writer, emoji picker) need overrides.
//
// Resolution order when a screen action fires:
//   1. Wallet-provided handler (app override)
//   2. Default handler (this file)
//   3. Built-in copy/share handler (CONTENT_EXTRACTORS in createManager)
// ---------------------------------------------------------------------------

import { getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';

import { isMintOfflineError } from '../errors';
import { errField, logger } from '../logger';
import type { Destination, MachineOperations, PaymentMachine } from '../machine/types';
import { parseHistoryEntryOnce } from '../operations/historyEntry';
import type { ScreenActionContext, ScreenActionHandlerMap } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface NavigationCallbacks {
  scanQr?: (params: { unit: string; context: 'receive' | 'amount' }) => void;
  mintInfo?: (mintInfoEntry: string) => void;
  addMint?: () => void;
  goBack?: () => void;
}

export interface DefaultScreenActionHandlersConfig {
  getMachine: () => PaymentMachine | null;
  getOperations: () => Partial<MachineOperations> | undefined;
  notify: (event: string, ...args: unknown[]) => void;
  navigation: NavigationCallbacks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EntryLike = Record<string, unknown>;

function getString(entry: EntryLike | null | undefined, key: string): string | undefined {
  const v = entry?.[key];
  return typeof v === 'string' ? v : undefined;
}

function getNumber(entry: EntryLike | null | undefined, key: string): number | undefined {
  const v = entry?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function getMetadata(entry: EntryLike | null | undefined): EntryLike | undefined {
  const m = entry?.metadata;
  return typeof m === 'object' && m !== null ? (m as EntryLike) : undefined;
}

function encodeToken(entry: EntryLike): string | null {
  const token = entry.token;
  if (!token) return null;
  try {
    return getEncodedTokenV4(token as Parameters<typeof getEncodedTokenV4>[0]);
  } catch (e) {
    logger.warn('screenAction.encodeToken.failed', { error: errField(e) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDefaultScreenActionHandlers(
  config: DefaultScreenActionHandlersConfig
): ScreenActionHandlerMap {
  const { getMachine, getOperations, notify, navigation } = config;

  return {
    // ── sendToken ────────────────────────────────────────────────────
    sendToken: {
      checkStatus: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        const operationId = getString(entry, 'operationId');
        if (!operationId) return;

        const ops = getOperations();
        if (!ops?.checkSendStatus) return;

        logger.info('screenAction.sendToken.checkStatus.start', { operationId });
        const result = await ops.checkSendStatus(operationId);
        logger.info('screenAction.sendToken.checkStatus.result', {
          operationId,
          state: result.state,
        });
        notify('onSendStatusChecked', {
          operationId,
          state: result.state,
          redeemed: result.state === 'finalized',
        });
      },

      cancel: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        const operationId = getString(entry, 'operationId');
        if (!operationId) return;

        const ops = getOperations();
        if (!ops?.rollbackSend) return;

        logger.info('screenAction.sendToken.cancel.start', { operationId });
        try {
          await ops.rollbackSend(operationId);
          logger.info('screenAction.sendToken.cancel.done', { operationId });
          notify('onSendCancelled', { operationId });
        } catch (err) {
          const mintUnreachable = isMintOfflineError(err);
          logger.warn('screenAction.sendToken.cancel.failed', {
            operationId,
            mintUnreachable,
            error: errField(err),
          });
          notify('onSendCancelFailed', {
            operationId,
            message: err instanceof Error ? err.message : String(err),
            mintUnreachable,
          });
        }
      },
    },

    // ── receiveToken ─────────────────────────────────────────────────
    receiveToken: {
      redeem: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        const mintUrl = getString(entry, 'mintUrl');
        const amount = getNumber(entry, 'amount');
        const unit = getString(entry, 'unit') ?? 'sat';
        const id = getString(entry, 'id') ?? 'unknown';

        // Capture the original raw scanned/pasted/NFC/deeplink input from the
        // active flow context. encodeToken(entry) and entry.metadata.rawToken
        // are both re-encoded V4 forms that may differ byte-for-byte from
        // what the user actually entered, breaking the `processed === raw`
        // lookup in the wallet's scan history store. flowCtx.rawInput is the
        // canonical string that was originally recorded by addScan().
        const flowCtx = getMachine()?.getContext?.() as
          | { rawInput?: string; source?: string }
          | undefined;
        const scannedRawInput = flowCtx?.rawInput;

        const tokenString = encodeToken(entry);
        if (!tokenString || !mintUrl) return;

        // Validate unit — only sat is supported
        try {
          const decoded = getDecodedToken(tokenString);
          if (decoded.unit && decoded.unit !== 'sat') {
            notify('onUnsupportedTokenUnit', { unit: decoded.unit });
            return;
          }
        } catch (e) {
          logger.warn('screenAction.receiveToken.unitDecodeFailed', { error: errField(e) });
        }

        // Check mint trust
        const ops = getOperations();
        if (ops?.isMintTrusted) {
          const trusted = await ops.isMintTrusted(mintUrl);
          if (!trusted) {
            const machine = getMachine();
            if (machine) {
              await machine.reviewMint(mintUrl, tokenString);
            }
            return;
          }
        }

        // Dispatch processing notification
        logger.info('screenAction.receiveToken.redeem.processing', { mintUrl, amount, id });
        notify('onReceiveProcessing', { id, mintUrl, amount: amount ?? 0, unit });

        // Execute receive
        if (!ops?.executeReceive) return;

        try {
          const result = await ops.executeReceive(tokenString, mintUrl, amount ?? 0);
          logger.info('screenAction.receiveToken.redeem.success', { mintUrl });

          // Update screen entry with real history entry
          const setEntry = (ctx as EntryLike).setEntry as
            | ((e: EntryLike) => void)
            | undefined;
          logger.info('screenAction.receiveToken.redeem.entryUpdate.eligibility', {
            hasSetEntry: !!setEntry,
            hasHistoryEntry: !!result.historyEntry,
          });
          const realEntry = parseHistoryEntryOnce(result.historyEntry);
          if (setEntry && realEntry) {
            logger.info('screenAction.receiveToken.redeem.entryUpdate.apply', {
              id: realEntry.id,
              type: realEntry.type,
              amount: realEntry.amount,
            });
            setEntry(realEntry as EntryLike);

            // Link transaction for scan history. Prefer the original raw
            // input captured from flowCtx so the wallet's scan store can
            // match by `processed === raw`. Fall back to the entry's
            // metadata.rawToken (re-encoded form) only if flowCtx.rawInput
            // is missing (e.g. NPC/non-scan flows).
            if (ops.linkTransaction && realEntry.id) {
              const linkInput =
                scannedRawInput ??
                getString(getMetadata(entry), 'rawToken') ??
                tokenString;
              ops.linkTransaction(linkInput, realEntry.id);
            }
          } else if (!setEntry || !result.historyEntry) {
            logger.warn('screenAction.receiveToken.redeem.entryUpdate.skipped', {
              hasSetEntry: !!setEntry,
              hasHistoryEntry: !!result.historyEntry,
            });
          }

          notify('onReceiveConfirmed', {
            id,
            mintUrl,
            amount: amount ?? 0,
            unit,
            historyEntry: result.historyEntry,
          });

          if (realEntry?.id) {
            notify('onTransactionCreated', {
              transactionId: realEntry.id,
              type: 'receive',
              mintUrl,
              amount: amount ?? 0,
              unit,
              rawInput: scannedRawInput,
              source: flowCtx?.source,
            });
          }

          if (result.hadP2PKProofs != null) {
            notify('onP2PKReceiveCompleted', {
              transactionId: id,
              mintUrl,
              hadP2PKProofs: result.hadP2PKProofs,
            });
          }
        } catch (err) {
          notify('onReceiveFailed', {
            id,
            mintUrl,
            amount: amount ?? 0,
            unit,
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
    },

    // ── meltQuote ────────────────────────────────────────────────────
    meltQuote: {
      pay: async (_ctx: ScreenActionContext) => {
        logger.info('screenAction.meltQuote.pay');
        const machine = getMachine();
        if (machine?.confirmMelt) {
          await machine.confirmMelt();
        }
      },

      cancel: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        const operationId =
          getString(getMetadata(entry), 'operationId') ??
          getString(entry, 'operationId');
        const quoteId = getString(entry, 'quoteId');

        if (!operationId && !quoteId) return;

        const ops = getOperations();
        if (!ops?.rollbackMelt) return;

        const rollbackId = operationId ?? quoteId!;
        logger.info('screenAction.meltQuote.cancel.start', { operationId: rollbackId });

        try {
          await ops.rollbackMelt(rollbackId);
          logger.info('screenAction.meltQuote.cancel.done', { operationId: rollbackId });
          notify('onMeltCancelled', { operationId: rollbackId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Silently ignore "not found" errors — the operation may have
          // already been finalized or rolled back.
          if (
            msg.includes('Cannot rollback') ||
            msg.includes('not found') ||
            msg.includes('No melt operation')
          ) {
            logger.warn('screenAction.meltQuote.cancel.expected', { message: msg });
            return;
          }
          notify('onMeltCancelFailed', { operationId: rollbackId, message: msg, mintUnreachable: isMintOfflineError(err) });
        }
      },
    },

    // ── paymentRequest ───────────────────────────────────────────────
    paymentRequest: {
      confirm: async (ctx: ScreenActionContext) => {
        const machine = getMachine();
        if (!machine?.confirmPaymentRequest) return;

        // Capture the entry before the async call for reference.
        const preEntry = ctx.entry as EntryLike;
        logger.info('screenAction.paymentRequest.confirm.start', {
          operationId:
            getString(getMetadata(preEntry), 'operationId') ??
            getString(preEntry, 'operationId') ??
            null,
        });

        const result = await machine.confirmPaymentRequest();

        const setEntry = ctx.setEntry as ((e: EntryLike) => void) | undefined;

        // If the delivery failed and ecash was rolled back, set the entry
        // to rolledBack state instead of enriching with delivered metadata.
        if (result.rolledBack) {
          logger.info('screenAction.paymentRequest.confirm.rolledBack');
          if (setEntry) {
            const metadata = ((preEntry?.metadata ?? {}) as Record<string, unknown>);
            const operationId = getString(getMetadata(preEntry), 'operationId') ??
              getString(preEntry, 'operationId') ?? getString(preEntry, 'id');
            setEntry({
              ...preEntry,
              state: 'rolledBack',
              operationId,
              metadata: {
                ...metadata,
                operationId,
                phase: 'rolledBack',
                tokenCreated: 'true',
              },
            } as EntryLike);
          }
          return;
        }

        // Success path — enrich the screen entry with delivery metadata.
        if (setEntry) {
          const metadata = ((preEntry?.metadata ?? {}) as Record<string, unknown>);
          const operationId = getString(getMetadata(preEntry), 'operationId') ??
            getString(preEntry, 'operationId') ?? getString(preEntry, 'id');
          const enriched = {
            ...preEntry,
            state: 'pending',
            operationId,
            metadata: {
              ...metadata,
              operationId,
              phase: 'delivered',
              tokenCreated: 'true',
              nostrSent: 'true',
            },
          };
          logger.info('screenAction.paymentRequest.confirm.enrich', {
            id: (enriched as any).id,
            operationId,
          });
          setEntry(enriched as EntryLike);
        }
      },

      cancel: async () => {
        navigation.goBack?.();
      },
    },

    // ── receive ──────────────────────────────────────────────────────
    receive: {
      paste: async () => {
        const machine = getMachine();
        await machine?.scan?.();
      },

      fixedAmount: async () => {
        const machine = getMachine();
        await machine?.startReceiveLightning();
      },

      scanQr: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        const unit = getString(entry, 'unit') ?? 'sat';
        navigation.scanQr?.({ unit, context: 'receive' });
      },

      changeNpcMint: async () => {
        const machine = getMachine();
        await machine?.requestMintSelector({ scope: 'npc' });
      },
    },

    // ── mintInfo ─────────────────────────────────────────────────────
    mintInfo: {
      trust: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        const mintUrl = getString(entry, 'mintUrl');
        if (!mintUrl) return;

        const ops = getOperations();
        if (!ops?.trustMint) return;

        logger.info('screenAction.mintInfo.trust.start', { mintUrl });
        await ops.trustMint(mintUrl);
        logger.info('screenAction.mintInfo.trust.done', { mintUrl });
        notify('onMintTrustedFromScreen', {
          mintUrl,
          fromAccepter: entry.fromAccepter === true,
        });
      },
    },

    // ── mintSelector ─────────────────────────────────────────────────
    mintSelector: {
      select: async (ctx: ScreenActionContext) => {
        const machine = getMachine();
        const mintUrl = (ctx as EntryLike).mintUrl as string | undefined;
        const entry = ctx.entry as EntryLike;
        const scope = (entry.scope as 'npc' | 'selected') ?? 'selected';
        if (!mintUrl || !machine) return;
        logger.info('screenAction.mintSelector.select', { mintUrl, scope });
        await machine.changeMint(mintUrl, { scope });
      },

      getInfo: async (ctx: ScreenActionContext) => {
        const mintUrl = (ctx as EntryLike).mintUrl as string | undefined;
        if (!mintUrl) return;

        // The selector hands the full row in via `actions.getInfo.execute`
        // so audit/score travel with the navigation; falls back to a
        // cache-only build for callers that don't have a row.
        const item = (ctx as EntryLike).item as
          | import('../types').MintListItem
          | undefined;

        const ops = getOperations();
        let infoEntry: EntryLike = { mintUrl };
        if (ops?.buildMintReviewInfo) {
          try {
            const info = await ops.buildMintReviewInfo(mintUrl, item);
            infoEntry = { ...(info as unknown as EntryLike) };
          } catch (e) {
            logger.warn('screenAction.mintInfo.buildReviewInfo.failed', {
              mintUrl,
              error: errField(e),
            });
          }
        }
        navigation.mintInfo?.(JSON.stringify(infoEntry));
      },

      addMint: async () => {
        navigation.addMint?.();
      },
    },

    // ── amountEntry ──────────────────────────────────────────────────
    amountEntry: {
      next: async (ctx: ScreenActionContext) => {
        const machine = getMachine();
        if (!machine) return;
        const entry = ctx.entry as EntryLike;
        const effectiveSat = entry.effectiveSatAmount;
        const mintUrl =
          typeof entry.selectedMintUrl === 'string' ? entry.selectedMintUrl : '';
        if (typeof effectiveSat !== 'number' || effectiveSat <= 0) return;
        const entryDestination = entry.destination as Destination | undefined;
        if (!entryDestination) return;

        // variantId may be provided by the Next variants menu (ecash /
        // lightning). When it matches the entry's destination category we just
        // pass it through; the only case that needs a real switch is picking
        // Lightning from a sendEcash flow that carries a meltTarget (the
        // "Send Money" DM path where both ecash and lightning are available).
        const variantId = typeof ctx.variantId === 'string' ? ctx.variantId : undefined;
        const meltTargetFromEntry = typeof entry.meltTarget === 'string' ? entry.meltTarget : '';
        // Identity fields are accepted from two sources, in priority order:
        //   1. Per-call `execute(params)` — the amount screen passes whatever
        //      it has locally resolved at the moment of submit (NIP-05 +
        //      kind-0 from its screen-level fallback). One-shot, no entry
        //      mutation, no reactive state churn.
        //   2. The entry itself — chat-launched flows seed it at flow start.
        const ctxRecipientPubkey =
          typeof (ctx as Record<string, unknown>).recipientPubkey === 'string'
            ? ((ctx as Record<string, unknown>).recipientPubkey as string)
            : undefined;
        const recipientPubkey = ctxRecipientPubkey ?? getString(entry, 'recipientPubkey');
        const ctxRecipientProfile =
          (ctx as Record<string, unknown>).recipientProfile &&
          typeof (ctx as Record<string, unknown>).recipientProfile === 'object'
            ? ((ctx as Record<string, unknown>).recipientProfile as {
                displayName: string;
                avatarUrl: string | null;
                nip05: string | null;
              })
            : undefined;
        const entryRecipientProfile =
          entry.recipientProfile && typeof entry.recipientProfile === 'object'
            ? (entry.recipientProfile as {
                displayName: string;
                avatarUrl: string | null;
                nip05: string | null;
              })
            : undefined;
        const recipientProfile = ctxRecipientProfile ?? entryRecipientProfile;

        let destination: Destination = entryDestination;
        let meltTarget: string | undefined;

        if (variantId === 'lightning') {
          if (entryDestination === 'meltQuote' || entryDestination === 'mintQuote') {
            // Already on a lightning-backed flow — keep destination as-is.
            destination = entryDestination;
          } else if (meltTargetFromEntry) {
            // Send-money path: switch sendEcash → meltQuote, seed meltTarget.
            destination = 'meltQuote';
            meltTarget = meltTargetFromEntry;
          } else {
            logger.warn('screenAction.amountEntry.next.lightningWithoutMeltTarget');
            return;
          }
        } else if (variantId === 'ecash') {
          if (entryDestination === 'mintQuote') {
            logger.warn('screenAction.amountEntry.next.ecashOnMintQuote');
            return;
          }
          // sendEcash / paymentRequest keep their destination; nothing to do.
          destination = entryDestination;
        } else if (variantId === 'onchain') {
          logger.info('screenAction.amountEntry.next.onchainNotSupported');
          return;
        }

        logger.info('screenAction.amountEntry.next.confirm', {
          amount: effectiveSat,
          mintUrl: mintUrl || null,
          destination,
          variantId: variantId ?? null,
          meltTargetPreview: meltTarget ? meltTarget.slice(0, 30) + '…' : null,
          recipientPubkeyPresent: !!recipientPubkey,
          recipientProfilePresent: !!recipientProfile,
        });
        try {
          await machine.enterAmount(effectiveSat, mintUrl, {
            destination,
            meltTarget,
            recipientPubkey,
            recipientProfile,
          });
          logger.info('screenAction.amountEntry.next.resolved');
        } catch (err) {
          logger.warn('screenAction.amountEntry.next.threw', { error: errField(err) });
          throw err;
        }
      },

      paste: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        if (entry.destination !== 'sendEcash') return;
        const machine = getMachine();
        await machine?.scan?.();
      },

      scanQr: async (ctx: ScreenActionContext) => {
        const entry = ctx.entry as EntryLike;
        if (entry.destination !== 'sendEcash') return;
        const unit = getString(entry, 'unit') ?? 'sat';
        navigation.scanQr?.({ unit, context: 'amount' });
      },
    },
  };
}
