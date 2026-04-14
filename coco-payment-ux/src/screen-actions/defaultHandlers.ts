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
import type { Destination, MachineOperations, PaymentMachine } from '../machine/types';
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
    console.warn('[encodeToken] Failed to encode token:', e instanceof Error ? e.message : e);
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

        console.info('[sendToken.checkStatus] Checking | operationId:', operationId);
        const result = await ops.checkSendStatus(operationId);
        console.info('[sendToken.checkStatus] Result | operationId:', operationId, '| state:', result.state);
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

        console.info('[sendToken.cancel] Cancelling | operationId:', operationId);
        try {
          await ops.rollbackSend(operationId);
          console.info('[sendToken.cancel] Cancelled | operationId:', operationId);
          notify('onSendCancelled', { operationId });
        } catch (err) {
          const mintUnreachable = isMintOfflineError(err);
          console.warn('[sendToken.cancel] Failed | operationId:', operationId, mintUnreachable ? '(mint unreachable)' : '', err instanceof Error ? err.message : err);
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
          console.warn('[receiveToken] Token decode failed for unit check, proceeding:', e instanceof Error ? e.message : e);
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
        console.info('[receiveToken.redeem] Processing | mintUrl:', mintUrl, '| amount:', amount, '| id:', id);
        notify('onReceiveProcessing', { id, mintUrl, amount: amount ?? 0, unit });

        // Execute receive
        if (!ops?.executeReceive) return;

        try {
          const result = await ops.executeReceive(tokenString, mintUrl, amount ?? 0);
          console.info('[receiveToken.redeem] Received successfully | mintUrl:', mintUrl);

          // Update screen entry with real history entry
          const setEntry = (ctx as EntryLike).setEntry as
            | ((e: EntryLike) => void)
            | undefined;
          console.info('[receiveToken.redeem] setEntry available:', !!setEntry, '| historyEntry available:', !!result.historyEntry);
          if (setEntry && result.historyEntry) {
            try {
              const realEntry = JSON.parse(result.historyEntry);
              console.info('[receiveToken.redeem] Updating screen entry | id:', realEntry.id, '| type:', realEntry.type, '| amount:', realEntry.amount);
              setEntry(realEntry);

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
            } catch (e) {
              console.warn('[receiveToken] History entry parse failed:', e instanceof Error ? e.message : e);
            }
          } else {
            console.warn('[receiveToken.redeem] Cannot update screen entry — setEntry:', !!setEntry, '| historyEntry:', !!result.historyEntry);
          }

          notify('onReceiveConfirmed', {
            id,
            mintUrl,
            amount: amount ?? 0,
            unit,
            historyEntry: result.historyEntry,
          });

          try {
            const parsed = JSON.parse(result.historyEntry);
            if (parsed?.id) {
              notify('onTransactionCreated', {
                transactionId: parsed.id,
                type: 'receive',
                mintUrl,
                amount: amount ?? 0,
                unit,
                rawInput: scannedRawInput,
                source: flowCtx?.source,
              });
            }
          } catch { /* ignore parse errors */ }

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
        console.info('[meltQuote.pay] Confirming melt payment');
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
        console.info('[meltQuote.cancel] Cancelling | operationId:', rollbackId);

        try {
          await ops.rollbackMelt(rollbackId);
          console.info('[meltQuote.cancel] Cancelled | operationId:', rollbackId);
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
            console.warn('[meltCancel] Expected rollback error (already finalized/rolled back):', msg);
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
        console.info('[paymentRequest.confirm] Confirming | operationId:', getString(getMetadata(preEntry), 'operationId') ?? getString(preEntry, 'operationId') ?? '-');

        const result = await machine.confirmPaymentRequest();

        const setEntry = ctx.setEntry as ((e: EntryLike) => void) | undefined;

        // If the delivery failed and ecash was rolled back, set the entry
        // to rolledBack state instead of enriching with delivered metadata.
        if (result.rolledBack) {
          console.info('[paymentRequest.confirm] Rolled back — setting rolledBack entry');
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
          console.info('[paymentRequest.confirm] Enriching screen entry | id:', (enriched as any).id, '| operationId:', operationId);
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

        console.info('[mintInfo.trust] Trusting mint | mintUrl:', mintUrl);
        await ops.trustMint(mintUrl);
        console.info('[mintInfo.trust] Mint trusted | mintUrl:', mintUrl);
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
        console.info('[mintSelector.select] Selecting mint | mintUrl:', mintUrl, '| scope:', scope);
        await machine.changeMint(mintUrl, { scope });
      },

      getInfo: async (ctx: ScreenActionContext) => {
        const mintUrl = (ctx as EntryLike).mintUrl as string | undefined;
        if (!mintUrl) return;

        const ops = getOperations();
        let infoEntry: EntryLike = { mintUrl };
        if (ops?.buildMintReviewInfo) {
          try {
            const info = await ops.buildMintReviewInfo(mintUrl);
            infoEntry = { ...(info as unknown as EntryLike) };
          } catch (e) {
            console.warn('[mintInfo] buildMintReviewInfo failed for', mintUrl, e instanceof Error ? e.message : e);
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
        const destination = entry.destination as Destination | undefined;
        if (!destination) return;
        console.info('[amountEntry.next] Amount confirmed | amount:', effectiveSat, '| mintUrl:', mintUrl || '(none)', '| destination:', destination);
        void machine.enterAmount(effectiveSat, mintUrl, { destination });
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
