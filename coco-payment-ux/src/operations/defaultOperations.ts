// ---------------------------------------------------------------------------
// Default Operations — backed by coco-cashu-core Manager
//
// Complete operations that use the Manager API + built-in LNURL resolution.
// Wallet apps get these out of the box and only need to provide what's
// app-specific: handlers (navigation), notifications (UI), and platform
// primitives.
//
// App-side operations (NOT included here, injected via enrichment callbacks):
//   linkTransaction       — needs app-specific scan history store
//   Mint catalog data     — bulk fetch (audit / KYM / operator profile),
//                           injected via fetchMintCatalog
//   Mint review detail    — per-mint enrichment for the trust review screen,
//                           injected via enrichMintReviewInfo
// ---------------------------------------------------------------------------

import { getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import type { MachineOperations, StepDataMap } from '../machine/types';
import type { MintCatalogEntry, MintListItem, MintReviewInfo, PaymentRequestInfo } from '../types';
import { defaultDetectors } from '../detectors';
import { errField, logger } from '../logger';
import { requestInvoiceFromLnurl, isLightningInvoiceBolt11 } from '../lnurl';

// ---------------------------------------------------------------------------
// History lookup helpers
// ---------------------------------------------------------------------------

async function findSendHistoryEntryByOperationId(
  mgr: Manager,
  operationId: string
): Promise<string | null> {
  const history = await mgr.history.getPaginatedHistory(0, 50);
  const entry = history.find(
    (h: any) =>
      h.type === 'send' &&
      (h.operationId === operationId || h.metadata?.operationId === operationId)
  );
  return entry ? JSON.stringify(entry) : null;
}

function mapMeltOperationState(state: string): string {
  if (state === 'finalized') return 'PAID';
  if (state === 'pending' || state === 'executing') return 'PENDING';
  return 'UNPAID';
}

function hasP2PKProofs(proofs: readonly { secret: string }[]): boolean {
  return proofs.some((proof) => {
    try {
      const parsed = JSON.parse(proof.secret);
      return Array.isArray(parsed) && parsed[0] === 'P2PK';
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Payment request rollback helpers
// ---------------------------------------------------------------------------

async function attemptRollback(mgr: Manager, operationId: string): Promise<boolean> {
  try {
    const operation = await mgr.ops.send.get(operationId);
    if (operation && operation.state === 'prepared') {
      logger.info('operations.attemptRollback.cancelPrepared', { operationId });
      await mgr.ops.send.cancel(operationId);
    } else if (operation && ['executing', 'pending'].includes(operation.state)) {
      logger.info('operations.attemptRollback.reclaim', {
        state: operation.state,
        operationId,
      });
      await mgr.ops.send.reclaim(operationId);
    } else {
      logger.warn('operations.attemptRollback.unexpectedState', {
        state: operation?.state,
        operationId,
      });
      return false;
    }
    logger.info('operations.attemptRollback.success', { operationId });
    return true;
  } catch (e) {
    logger.warn('operations.attemptRollback.failed', {
      operationId,
      error: errField(e),
    });
    return false;
  }
}

function buildRolledBackResult(
  operationId: string,
  mintUrl: string,
  amount: number,
  unit: string,
  paymentRequest: string,
  transportType: 'nostr' | 'http',
  errorMessage: string
): { historyEntry: string; rolledBack: true; errorMessage: string } {
  const entry = {
    id: operationId,
    type: 'send' as const,
    createdAt: Date.now(),
    mintUrl,
    amount,
    unit,
    operationId,
    state: 'rolledBack',
    metadata: {
      paymentRequest,
      phase: 'rolledBack',
      tokenCreated: 'true',
      transportType,
      errorMessage,
    },
  };
  logger.info('operations.executePaymentRequest.rolledBack', {
    operationId,
    errorMessage,
  });
  return { historyEntry: JSON.stringify(entry), rolledBack: true, errorMessage };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DefaultOperationsConfig {
  getManager: () => Manager | null;
  getProofAmounts?: () => Record<string, number[]>;
  getPreferredMintUrl?: () => string | undefined;
  /** Required for Nostr payment request transport. Wallet supplies a NIP-17 publisher bound to the user's private key. */
  sendNostrDM?: (nprofile: string, message: string) => Promise<void>;
  /**
   * Bulk catalog fetcher for mint list items. Awaited inside `buildMintListItems`
   * before items are produced, so audit / KYM / operator-profile data flows
   * straight into each row instead of arriving later through cache subscriptions.
   *
   * The wallet implements this with whatever bulk API it has (e.g. a single
   * search-style endpoint that returns aggregates for every known mint). One
   * call per list build, not one per mint.
   *
   * Mints not present in the returned record render with no catalog data — the
   * row falls back to the mint URL / NUT-06 info already on screen.
   */
  fetchMintCatalog?: (mintUrls: string[]) => Promise<Record<string, MintCatalogEntry>>;
  /**
   * Optional per-mint enrichment for the trust-review screen. Synchronous,
   * read from local caches the wallet already populated (e.g. a screen that
   * needed the same audit data earlier in the session).
   */
  enrichMintReviewInfo?: (mintUrl: string) => Partial<MintReviewInfo>;
  /** When true, executePaymentRequest simulates a delivery failure to test rollback. */
  shouldMockFailPaymentRequest?: () => boolean;
  /**
   * Per-request timeout for external lightning calls (LNURL pay-params,
   * LNURL invoice callback). Plumbed into `requestInvoiceFromLnurl` so a
   * stalled lightning-address provider cannot wedge the melt critical
   * path indefinitely. Defaults to the helper's own default (15s).
   */
  lightningTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDefaultOperations(
  config: DefaultOperationsConfig
): Partial<MachineOperations> {
  const { getManager, getProofAmounts } = config;

  function requireManager(): Manager {
    const mgr = getManager();
    if (!mgr) {
      logger.warn('operations.requireManager.unavailable');
      throw new Error('Wallet manager is not available');
    }
    return mgr;
  }

  return {
    executeSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      logger.info('operations.executeSend.prepare', { mintUrl, amount });
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });
      logger.info('operations.executeSend.execute', { operationId: prepared.id });
      const { operation, token } = await mgr.ops.send.execute(prepared.id);
      logger.info('operations.executeSend.complete', {
        operationId: operation.id,
        state: operation.state,
      });

      // Try history first (should be there after execute), fall back to
      // constructing from the operation result to avoid a race.
      const historyEntry = await findSendHistoryEntryByOperationId(mgr, operation.id);
      if (historyEntry) {
        // Ensure the token is present — the DB row may not have it yet due to a race.
        const parsed = JSON.parse(historyEntry);
        if (!parsed.token && token) {
          parsed.token = token;
          return { historyEntry: JSON.stringify(parsed) };
        }
        return { historyEntry };
      }

      logger.warn('operations.executeSend.historyMissing', { operationId: operation.id });
      const entry = {
        id: operation.id,
        type: 'send' as const,
        createdAt: operation.createdAt,
        mintUrl: operation.mintUrl,
        unit: 'sat',
        state: 'pending',
        amount: operation.amount,
        token,
        metadata: { operationId: operation.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    executeOfflineSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });

      if (prepared.needsSwap) {
        logger.warn('operations.executeOfflineSend.needsSwap', {
          operationId: prepared.id,
          mintUrl,
          amount,
        });
        await mgr.ops.send.cancel(prepared.id);
        throw new Error('Offline send requires exact proof match');
      }

      const { operation, token } = await mgr.ops.send.execute(prepared.id);

      const historyEntry = await findSendHistoryEntryByOperationId(mgr, operation.id);
      if (historyEntry) {
        const parsed = JSON.parse(historyEntry);
        if (!parsed.token && token) {
          parsed.token = token;
          return { historyEntry: JSON.stringify(parsed) };
        }
        return { historyEntry };
      }

      logger.warn('operations.executeOfflineSend.historyMissing', { operationId: operation.id });
      const entry = {
        id: operation.id,
        type: 'send' as const,
        createdAt: operation.createdAt,
        mintUrl: operation.mintUrl,
        unit: 'sat',
        state: 'pending',
        amount: operation.amount,
        token,
        metadata: { operationId: operation.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    executeMintQuote: async (mintUrl, amount, _unit) => {
      const mgr = requireManager();
      logger.info('operations.executeMintQuote.prepare', { mintUrl, amount });
      const mintOp = await mgr.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' });
      logger.info('operations.executeMintQuote.created', {
        operationId: mintOp.id,
        quoteId: mintOp.quoteId,
      });

      // Build entry directly from the operation result to avoid a race
      // where getPaginatedHistory runs before HistoryService persists the row.
      const entry = {
        id: mintOp.id,
        type: 'mint' as const,
        createdAt: mintOp.createdAt,
        mintUrl: mintOp.mintUrl,
        unit: mintOp.unit,
        quoteId: mintOp.quoteId,
        state: 'UNPAID',
        amount: mintOp.amount,
        paymentRequest: mintOp.request,
        metadata: { operationId: mintOp.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (data: StepDataMap['selectMint']): Promise<MintListItem[]> => {
      const mgr = requireManager();
      const t0 = performance.now();
      logger.info('operations.buildMintListItems.start', {
        unit: data.unit,
        scope: data.scope,
        destination: data.destination,
      });
      const [allTrustedMints, balancesByMint] = await Promise.all([
        mgr.mint.getAllTrustedMints(),
        mgr.wallet.balances.byMint(),
      ]);
      const balances: Record<string, number> = Object.fromEntries(
        Object.entries(balancesByMint).map(([url, snap]) => [url, snap.total])
      );

      // Fetch NUT-06 mint info for each mint in parallel.
      // getAllTrustedMints() returns stored records without display metadata;
      // getMintInfo() returns the NUT-06 info with name/icon_url.
      const mintInfoMap = new Map<string, any>();
      await Promise.all(
        allTrustedMints.map(async (mint: any) => {
          try {
            const info = await mgr.mint.getMintInfo(mint.mintUrl);
            if (info) {
              mintInfoMap.set(mint.mintUrl, info);
              logger.info('operations.buildMintListItems.getMintInfo.ok', {
                mintUrl: mint.mintUrl,
                name: info.name,
                hasIcon: !!info.icon_url,
              });
            } else {
              logger.warn('operations.buildMintListItems.getMintInfo.null', {
                mintUrl: mint.mintUrl,
              });
            }
          } catch (e) {
            logger.warn('operations.buildMintListItems.getMintInfo.failed', {
              mintUrl: mint.mintUrl,
              error: errField(e),
            });
          }
        })
      );
      logger.info('operations.buildMintListItems.info.resolved', {
        resolved: mintInfoMap.size,
        total: allTrustedMints.length,
        durationMs: Math.round(performance.now() - t0),
      });

      // One bulk fetch — the wallet returns audit / KYM / operator-profile
      // data for every trusted mint in a single round-trip. Awaited so items
      // ship to the screen with catalog fields already populated.
      const mintUrls = allTrustedMints.map((m: any): string => m.mintUrl);
      let catalog: Record<string, MintCatalogEntry> = {};
      if (config.fetchMintCatalog) {
        try {
          catalog = await config.fetchMintCatalog(mintUrls);
        } catch (e) {
          logger.warn('operations.buildMintListItems.fetchMintCatalog.failed', {
            error: errField(e),
          });
        }
      }

      const supportedSet = data.supportedMintUrls ? new Set(data.supportedMintUrls) : null;

      const proofAmounts = getProofAmounts?.() ?? {};

      const items = allTrustedMints.map((mint: any): MintListItem => {
        const mintUrl = mint.mintUrl;
        const info: any = mintInfoMap.get(mintUrl) ?? {};
        const balance = balances[mintUrl] ?? 0;
        const isInCandidate = data.candidates.some((c) => c.mintUrl === mintUrl);

        let status: 'available' | 'disabled' = 'available';
        let reason: MintListItem['reason'] = null;

        // Balance checks only apply in send-type flows (melt/send/payment request).
        // All other cases (no destination, mintQuote, scope override) allow every mint.
        const needsBalanceCheck =
          data.destination === 'paymentRequest' ||
          data.destination === 'meltQuote' ||
          data.destination === 'sendEcash';
        const skipBalanceCheck =
          !needsBalanceCheck || data.scope === 'selected' || data.scope === 'npc';

        if (supportedSet && !supportedSet.has(mintUrl)) {
          status = 'disabled';
          reason = { code: 'NOT_IN_PAYMENT_REQUEST', message: 'Not accepted by payment request' };
        } else if (!skipBalanceCheck && data.amount && balance < data.amount) {
          status = 'disabled';
          reason = { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' };
        } else if (!skipBalanceCheck && !isInCandidate && balance <= 0) {
          status = 'disabled';
          reason = { code: 'NO_BALANCE', message: 'No balance' };
        }

        const entry = catalog[mintUrl] ?? {};
        return {
          mintUrl,
          displayName: info.name ?? mintUrl,
          iconUrl: info.icon_url ?? undefined,
          balance,
          unit: data.unit,
          status,
          reason,
          isPreferred: false,
          kymScore: entry.kymScore,
          reviewCount: entry.reviewCount,
          auditScore: entry.auditScore,
          auditState: entry.auditState,
          auditTotalOps: entry.auditTotalOps,
          contactFollowers: entry.contactFollowers,
          contactReputation: entry.contactReputation,
        };
      });

      items.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'available' ? -1 : 1;
        return b.balance - a.balance;
      });

      return items;
    },

    trustMint: async (mintUrl) => {
      const mgr = requireManager();
      logger.info('operations.trustMint', { mintUrl });
      await mgr.mint.addMint(mintUrl, { trusted: true });
    },

    executeNfcSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      logger.info('operations.executeNfcSend.prepare', { mintUrl, amount });
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });
      const { operation, token } = await mgr.ops.send.execute(prepared.id);
      logger.info('operations.executeNfcSend.tokenCreated', { operationId: operation.id });
      const historyEntry = await findSendHistoryEntryByOperationId(mgr, operation.id);
      if (!historyEntry) {
        logger.warn('operations.executeNfcSend.historyMissing', {
          operationId: operation.id,
          mintUrl,
          amount,
        });
        throw new Error('Send history entry not found after creation');
      }
      return {
        token: getEncodedTokenV4(token),
        historyEntry,
        operationId: operation.id,
      };
    },

    rollbackSend: async (operationId) => {
      const mgr = getManager();
      if (!mgr) return;
      logger.info('operations.rollbackSend.start', { operationId });
      try {
        const operation = await mgr.ops.send.get(operationId);
        if (operation && operation.state === 'prepared') {
          logger.info('operations.rollbackSend.cancelPrepared', { operationId });
          await mgr.ops.send.cancel(operationId);
        } else if (operation && ['executing', 'pending'].includes(operation.state)) {
          logger.info('operations.rollbackSend.reclaim', {
            state: operation.state,
            operationId,
          });
          await mgr.ops.send.reclaim(operationId);
        }
      } catch (e) {
        logger.warn('operations.rollbackSend.failed', {
          operationId,
          error: errField(e),
        });
      }
    },

    // ── Screen action operations ────────────────────────────────────

    checkSendStatus: async (operationId) => {
      const mgr = requireManager();
      const operation = await mgr.ops.send.get(operationId);
      if (!operation) {
        return { state: 'not_found' };
      }
      if (operation.state === 'pending') {
        await mgr.ops.send.refresh(operationId);
        const updated = await mgr.ops.send.get(operationId);
        return { state: updated?.state ?? operation.state };
      }
      return { state: operation.state };
    },

    executeReceive: async (tokenString, mintUrl, _amount) => {
      const mgr = requireManager();
      logger.info('operations.executeReceive.start', {
        mintUrl,
        tokenPreview: tokenString.slice(0, 20) + '…',
      });
      await mgr.wallet.receive(tokenString);
      logger.info('operations.executeReceive.received');

      let hadP2PK = false;
      let tokenAmount = 0;
      try {
        const decoded = getDecodedToken(tokenString);
        hadP2PK = hasP2PKProofs(decoded.proofs);
        tokenAmount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
      } catch (e) {
        logger.warn('operations.executeReceive.p2pkDetectionFailed', { error: errField(e) });
      }

      // Try history first, fall back to constructing from known data
      // to avoid race where history write hasn't flushed yet.
      const historyEntry = await findReceiveHistoryEntry(mgr, tokenString, mintUrl);
      if (historyEntry) return { historyEntry, hadP2PKProofs: hadP2PK };

      logger.warn('operations.executeReceive.historyMissing', { mintUrl });
      const entry = {
        id: `redeemed-${Date.now()}`,
        type: 'receive' as const,
        createdAt: Date.now(),
        mintUrl,
        unit: 'sat',
        amount: tokenAmount,
        metadata: { rawToken: tokenString },
      };
      return { historyEntry: JSON.stringify(entry), hadP2PKProofs: hadP2PK };
    },

    isMintTrusted: async (mintUrl) => {
      const mgr = requireManager();
      return mgr.mint.isTrustedMint(mintUrl);
    },

    executeMelt: async (mintUrl, meltTarget, amount, _unit) => {
      const mgr = requireManager();
      logger.info('operations.executeMelt.start', {
        mintUrl,
        amount,
        targetPreview: meltTarget.slice(0, 30) + '…',
      });

      const bolt11 = isLightningInvoiceBolt11(meltTarget)
        ? meltTarget
        : await requestInvoiceFromLnurl(meltTarget, amount, {
            timeoutMs: config.lightningTimeoutMs,
          });

      const operation = await mgr.ops.melt.prepare({
        mintUrl,
        method: 'bolt11',
        methodData: { invoice: bolt11 },
      });
      logger.info('operations.executeMelt.execute', { operationId: operation.id });
      const result = await mgr.ops.melt.execute(operation.id);
      logger.info('operations.executeMelt.complete', {
        operationId: result.id,
        state: result.state,
      });

      const entry = {
        id: result.id,
        type: 'melt' as const,
        createdAt: result.createdAt,
        mintUrl: result.mintUrl,
        unit: 'sat',
        quoteId: result.quoteId,
        state: mapMeltOperationState(result.state),
        amount: result.amount,
        metadata: { operationId: result.id, meltTarget },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    rollbackMelt: async (operationId) => {
      const mgr = requireManager();
      logger.info('operations.rollbackMelt.start', { operationId });
      await mgr.ops.melt.cancel(operationId, 'User cancelled');
      logger.info('operations.rollbackMelt.done', { operationId });
    },

    buildMintReviewInfo: async (mintUrl, item): Promise<MintReviewInfo> => {
      const mgr = requireManager();
      const [mintInfo, balancesByMint, isTrusted] = await Promise.all([
        mgr.mint.getMintInfo(mintUrl).catch((e) => {
          logger.warn('operations.buildMintReviewInfo.getMintInfo.failed', {
            mintUrl,
            error: errField(e),
          });
          return undefined;
        }),
        mgr.wallet.balances.byMint({ mintUrls: [mintUrl] }),
        mgr.mint.isTrustedMint(mintUrl),
      ]);

      const info: any = mintInfo ?? {};
      const preferredMintUrl = config.getPreferredMintUrl?.();
      const enrichment = config.enrichMintReviewInfo?.(mintUrl) ?? {};

      // The Select Mint row already carries fresh catalog data from
      // `fetchMintCatalog`; prefer it over `enrichMintReviewInfo`'s cache
      // read so audit/score travel with the navigation rather than relying
      // on a separately-warmed Zustand store.
      const rowCatalog: Partial<MintReviewInfo> = {};
      if (item) {
        if (item.kymScore !== undefined) rowCatalog.kymScore = item.kymScore;
        if (item.auditScore !== undefined) rowCatalog.auditScore = item.auditScore;
        if (item.auditState !== undefined) rowCatalog.auditState = item.auditState;
      }

      const result: MintReviewInfo = {
        mintUrl,
        displayName: info.name ?? item?.displayName ?? mintUrl,
        iconUrl: info.icon_url ?? item?.iconUrl,
        description: info.description ?? undefined,
        longDescription: info.description_long ?? undefined,
        motd: info.motd ?? undefined,
        contact: info.contact ?? undefined,
        nuts: info.nuts ? Object.keys(info.nuts).map(Number) : undefined,
        balance: balancesByMint[mintUrl]?.total ?? item?.balance ?? 0,
        unit: item?.unit ?? 'sat',
        isPreferred: item?.isPreferred ?? mintUrl === preferredMintUrl,
        isTrusted,
        ...enrichment,
        ...rowCatalog,
      };

      // Detail metrics (avgTimeMs, swap counts, totals) only exist in the
      // local cache; when the user came straight from the selector without a
      // warm cache, fall back to the success rate implied by auditScore so
      // the StatsGrid's headline number stays meaningful.
      if (result.successRate === undefined && typeof result.auditScore === 'number') {
        result.successRate = result.auditScore / 5;
      }

      return result;
    },

    executePaymentRequest: async (mintUrl, paymentRequest, amount, unit) => {
      const mgr = requireManager();
      logger.info('operations.executePaymentRequest.start', { mintUrl, amount });

      const info = defaultDetectors.getPaymentRequestInfo(paymentRequest);
      if (!info) {
        logger.warn('operations.executePaymentRequest.parseFailed', {
          paymentRequestPreview: paymentRequest.slice(0, 60),
        });
        throw new Error('Invalid payment request');
      }

      const nostrTransport = info.transports?.find((t) => t.type === 'nostr');
      const httpTransport = info.transports?.find((t) => t.type === 'post');

      let operationId: string;

      if (nostrTransport && !httpTransport) {
        logger.info('operations.executePaymentRequest.transport', { transport: 'nostr' });
        // Nostr transport: use ops.send directly since PaymentRequestsApi doesn't support Nostr
        const sendNostrDM = config.sendNostrDM;
        if (!sendNostrDM) {
          logger.warn('operations.executePaymentRequest.nostrDM.unconfigured');
          throw new Error('sendNostrDM operation is required for Nostr payment requests');
        }

        const effectiveAmount = info.amount ?? amount;
        if (!effectiveAmount) {
          logger.warn('operations.executePaymentRequest.nostr.missingAmount');
          throw new Error('Amount is required for Nostr payment requests');
        }

        const prepared = await mgr.ops.send.prepare({ mintUrl, amount: effectiveAmount });
        const { operation, token } = await mgr.ops.send.execute(prepared.id);
        operationId = operation.id;

        const payload = {
          id: paymentRequest,
          mint: mintUrl,
          unit,
          proofs: token.proofs,
        };
        try {
          if (config.shouldMockFailPaymentRequest?.()) {
            throw new Error('Mock delivery failure (dev)');
          }
          await sendNostrDM(nostrTransport.target, JSON.stringify(payload));
          logger.info('operations.executePaymentRequest.nostr.sent', { operationId });
        } catch (deliveryErr) {
          logger.warn('operations.executePaymentRequest.nostr.deliveryFailed', {
            operationId,
            error: errField(deliveryErr),
          });
          const rollbackResult = await attemptRollback(mgr, operationId);
          if (rollbackResult) {
            const errorMessage =
              deliveryErr instanceof Error ? deliveryErr.message : 'Nostr delivery failed';
            return buildRolledBackResult(
              operationId,
              mintUrl,
              effectiveAmount,
              unit,
              paymentRequest,
              'nostr',
              errorMessage
            );
          }
          throw deliveryErr;
        }
      } else {
        logger.info('operations.executePaymentRequest.transport', { transport: 'http' });
        // HTTP or inband transport: use paymentRequests API
        const parsed = await mgr.paymentRequests.parse(paymentRequest);
        const transaction = await mgr.paymentRequests.prepare(parsed, { mintUrl, amount });
        operationId = transaction.sendOperation.id;
        try {
          if (config.shouldMockFailPaymentRequest?.()) {
            throw new Error('Mock delivery failure (dev)');
          }
          await mgr.paymentRequests.execute(transaction);
          logger.info('operations.executePaymentRequest.http.executed', { operationId });
        } catch (deliveryErr) {
          logger.warn('operations.executePaymentRequest.http.deliveryFailed', {
            operationId,
            error: errField(deliveryErr),
          });
          const rollbackResult = await attemptRollback(mgr, operationId);
          if (rollbackResult) {
            const errorMessage =
              deliveryErr instanceof Error ? deliveryErr.message : 'HTTP delivery failed';
            return buildRolledBackResult(
              operationId,
              mintUrl,
              amount,
              unit,
              paymentRequest,
              'http',
              errorMessage
            );
          }
          throw deliveryErr;
        }
      }

      const historyEntry = await findSendHistoryEntryByOperationId(mgr, operationId);
      const entry = historyEntry
        ? JSON.parse(historyEntry)
        : {
            id: operationId,
            type: 'send' as const,
            createdAt: Date.now(),
            mintUrl,
            amount,
            unit,
            operationId,
            state: 'pending',
          };
      // Enrich with transport metadata so the screen can show progress
      entry.metadata = {
        ...(entry.metadata ?? {}),
        paymentRequest,
        phase: 'delivered',
        tokenCreated: 'true',
        ...(nostrTransport
          ? { nostrSent: 'true', transportType: 'nostr' }
          : { transportType: 'http' }),
      };
      entry.operationId = entry.operationId ?? operationId;
      logger.info('operations.executePaymentRequest.done', {
        operationId,
        transport: nostrTransport ? 'nostr' : 'http',
      });
      return { historyEntry: JSON.stringify(entry) };
    },
  };
}

// ---------------------------------------------------------------------------
// Payment request helpers
// ---------------------------------------------------------------------------

function buildInbandParsed(encodedRequest: string, info: PaymentRequestInfo, mintUrl: string): any {
  const requiredMints = info.mints ?? [];
  const matchingMints =
    requiredMints.length > 0
      ? requiredMints.filter((candidate) => candidate === mintUrl)
      : [mintUrl];

  return {
    paymentRequest: encodedRequest,
    matchingMints,
    requiredMints,
    amount: info.amount,
    transport: { type: 'inband' as const },
  };
}

// ---------------------------------------------------------------------------
// Receive history lookup helper
// ---------------------------------------------------------------------------

async function findReceiveHistoryEntry(
  mgr: Manager,
  tokenString: string,
  mintUrl: string
): Promise<string | null> {
  const history = await mgr.history.getPaginatedHistory(0, 50);
  const entry = history.find(
    (h: any) =>
      h.type === 'receive' &&
      h.mintUrl === mintUrl &&
      (h.metadata?.rawToken === tokenString || h.token === tokenString)
  );
  return entry ? JSON.stringify(entry) : null;
}
