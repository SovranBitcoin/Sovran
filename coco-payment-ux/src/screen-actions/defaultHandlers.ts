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
  } catch {
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

        const result = await ops.checkSendStatus(operationId);
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

        try {
          await ops.rollbackSend(operationId);
          notify('onSendCancelled', { operationId });
        } catch (err) {
          notify('onSendCancelFailed', {
            operationId,
            message: err instanceof Error ? err.message : String(err),
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

        const tokenString = encodeToken(entry);
        if (!tokenString || !mintUrl) return;

        // Validate unit — only sat is supported
        try {
          const decoded = getDecodedToken(tokenString);
          if (decoded.unit && decoded.unit !== 'sat') {
            notify('onUnsupportedTokenUnit', { unit: decoded.unit });
            return;
          }
        } catch {
          // If decode fails, proceed anyway — let executeReceive handle it
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
        notify('onReceiveProcessing', { id, mintUrl, amount: amount ?? 0, unit });

        // Execute receive
        if (!ops?.executeReceive) return;

        try {
          const result = await ops.executeReceive(tokenString, mintUrl, amount ?? 0);

          // Update screen entry with real history entry
          const setEntry = (ctx as EntryLike).setEntry as
            | ((e: EntryLike) => void)
            | undefined;
          if (setEntry && result.historyEntry) {
            try {
              const realEntry = JSON.parse(result.historyEntry);
              setEntry(realEntry);

              // Link transaction for scan history
              if (ops.linkTransaction && realEntry.id) {
                const rawToken =
                  getString(getMetadata(entry), 'rawToken') ?? tokenString;
                ops.linkTransaction(rawToken, realEntry.id);
              }
            } catch {
              // JSON parse failed — skip entry update
            }
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

        try {
          await ops.rollbackMelt(rollbackId);
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
            return;
          }
          notify('onMeltCancelFailed', { operationId: rollbackId, message: msg });
        }
      },
    },

    // ── paymentRequest ───────────────────────────────────────────────
    paymentRequest: {
      confirm: async (_ctx: ScreenActionContext) => {
        const machine = getMachine();
        if (machine?.confirmPaymentRequest) {
          await machine.confirmPaymentRequest();
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

        await ops.trustMint(mintUrl);
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
          } catch {
            // Fall through with bare mintUrl
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
