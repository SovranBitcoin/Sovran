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
      console.info('[attemptRollback] Cancelling prepared operation | operationId:', operationId);
      await mgr.ops.send.cancel(operationId);
    } else if (operation && ['executing', 'pending'].includes(operation.state)) {
      console.info(
        '[attemptRollback] Reclaiming',
        operation.state,
        'operation | operationId:',
        operationId
      );
      await mgr.ops.send.reclaim(operationId);
    } else {
      console.warn(
        '[attemptRollback] Operation in unexpected state:',
        operation?.state,
        '| operationId:',
        operationId
      );
      return false;
    }
    console.info('[attemptRollback] Rollback successful | operationId:', operationId);
    return true;
  } catch (e) {
    console.warn(
      '[attemptRollback] Rollback failed | operationId:',
      operationId,
      e instanceof Error ? e.message : e
    );
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
  console.info(
    '[executePaymentRequest] Rolled back | operationId:',
    operationId,
    '| error:',
    errorMessage
  );
  return { historyEntry: JSON.stringify(entry), rolledBack: true, errorMessage };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DefaultOperationsConfig {
  getManager: () => Manager | null;
  getProofAmounts?: () => Record<string, number[]>;
  getPreferredMintUrl?: () => string | undefined;
  /** Required for Nostr payment request transport. Wallet wraps sendDirectMessageToRelays with the user's private key. */
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
      console.warn('[requireManager] Wallet manager is not available — getManager() returned null');
      throw new Error('Wallet manager is not available');
    }
    return mgr;
  }

  return {
    executeSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      console.info('[executeSend] Preparing | mintUrl:', mintUrl, '| amount:', amount);
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });
      console.info('[executeSend] Executing | operationId:', prepared.id);
      const { operation, token } = await mgr.ops.send.execute(prepared.id);
      console.info(
        '[executeSend] Complete | operationId:',
        operation.id,
        '| state:',
        (operation as any).state
      );

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

      console.warn(
        '[executeSend] History entry not found, building from operation | operationId:',
        operation.id
      );
      const entry = {
        id: operation.id,
        type: 'send' as const,
        createdAt: (operation as any).createdAt ?? Date.now(),
        mintUrl: (operation as any).mintUrl ?? mintUrl,
        unit: 'sat',
        state: 'pending',
        amount: (operation as any).amount ?? amount,
        token,
        metadata: { operationId: operation.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    executeOfflineSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });

      if (prepared.needsSwap) {
        console.warn(
          '[executeOfflineSend] Needs swap, cancelling | operationId:',
          prepared.id,
          '| mintUrl:',
          mintUrl,
          '| amount:',
          amount
        );
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

      console.warn(
        '[executeOfflineSend] History entry not found, building from operation | operationId:',
        operation.id
      );
      const entry = {
        id: operation.id,
        type: 'send' as const,
        createdAt: (operation as any).createdAt ?? Date.now(),
        mintUrl: (operation as any).mintUrl ?? mintUrl,
        unit: 'sat',
        state: 'pending',
        amount: (operation as any).amount ?? amount,
        token,
        metadata: { operationId: operation.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    executeMintQuote: async (mintUrl, amount, _unit) => {
      const mgr = requireManager();
      console.info(
        '[executeMintQuote] Preparing mint quote | mintUrl:',
        mintUrl,
        '| amount:',
        amount
      );
      const mintOp = await mgr.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' });
      console.info(
        '[executeMintQuote] Quote created | operationId:',
        mintOp.id,
        '| quoteId:',
        mintOp.quoteId
      );

      // Build entry directly from the operation result to avoid a race
      // where getPaginatedHistory runs before HistoryService persists the row.
      const entry = {
        id: mintOp.id,
        type: 'mint' as const,
        createdAt: (mintOp as any).createdAt ?? Date.now(),
        mintUrl: (mintOp as any).mintUrl ?? mintUrl,
        unit: (mintOp as any).unit ?? 'sat',
        quoteId: mintOp.quoteId,
        state: 'UNPAID',
        amount: (mintOp as any).amount ?? amount,
        paymentRequest: (mintOp as any).request,
        metadata: { operationId: mintOp.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (data: StepDataMap['selectMint']): Promise<MintListItem[]> => {
      const mgr = requireManager();
      const t0 = performance.now();
      console.info(
        '[buildMintListItems] Building mint list | unit:',
        data.unit,
        '| scope:',
        data.scope,
        '| destination:',
        data.destination
      );
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
              console.info(
                '[buildMintListItems] getMintInfo OK',
                mint.mintUrl,
                '| name:',
                info.name,
                '| icon:',
                !!info.icon_url
              );
            } else {
              console.warn('[buildMintListItems] getMintInfo returned null for', mint.mintUrl);
            }
          } catch (e) {
            console.warn(
              '[buildMintListItems] getMintInfo failed for',
              mint.mintUrl,
              e instanceof Error ? e.message : e
            );
          }
        })
      );
      console.info(
        '[buildMintListItems] info resolved:',
        mintInfoMap.size,
        '/',
        allTrustedMints.length,
        '| duration:',
        Math.round(performance.now() - t0),
        'ms'
      );

      // One bulk fetch — the wallet returns audit / KYM / operator-profile
      // data for every trusted mint in a single round-trip. Awaited so items
      // ship to the screen with catalog fields already populated.
      const mintUrls = allTrustedMints.map((m: any): string => m.mintUrl);
      let catalog: Record<string, MintCatalogEntry> = {};
      if (config.fetchMintCatalog) {
        try {
          catalog = await config.fetchMintCatalog(mintUrls);
        } catch (e) {
          console.warn(
            '[buildMintListItems] fetchMintCatalog failed, continuing without catalog data:',
            e instanceof Error ? e.message : e
          );
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
      console.info('[trustMint] Trusting mint | mintUrl:', mintUrl);
      await mgr.mint.addMint(mintUrl, { trusted: true });
    },

    executeNfcSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      console.info('[executeNfcSend] Preparing NFC send | mintUrl:', mintUrl, '| amount:', amount);
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });
      const { operation, token } = await mgr.ops.send.execute(prepared.id);
      console.info('[executeNfcSend] NFC token created | operationId:', operation.id);
      const historyEntry = await findSendHistoryEntryByOperationId(mgr, operation.id);
      if (!historyEntry) {
        console.warn(
          '[executeNfcSend] History entry not found | operationId:',
          operation.id,
          '| mintUrl:',
          mintUrl,
          '| amount:',
          amount
        );
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
      console.info('[rollbackSend] Starting | operationId:', operationId);
      try {
        const operation = await mgr.ops.send.get(operationId);
        if (operation && operation.state === 'prepared') {
          console.info('[rollbackSend] Cancelling prepared operation | operationId:', operationId);
          await mgr.ops.send.cancel(operationId);
        } else if (operation && ['executing', 'pending'].includes(operation.state)) {
          console.info(
            '[rollbackSend] Reclaiming',
            operation.state,
            'operation | operationId:',
            operationId
          );
          await mgr.ops.send.reclaim(operationId);
        }
      } catch (e) {
        console.warn(
          '[rollbackSend] Best-effort rollback failed | operationId:',
          operationId,
          e instanceof Error ? e.message : e
        );
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
      console.info(
        '[executeReceive] Receiving token | mintUrl:',
        mintUrl,
        '| token:',
        tokenString.slice(0, 20) + '…'
      );
      await mgr.wallet.receive(tokenString);
      console.info('[executeReceive] Token received');

      let hadP2PK = false;
      let tokenAmount = 0;
      try {
        const decoded = getDecodedToken(tokenString);
        hadP2PK = hasP2PKProofs(decoded.proofs);
        tokenAmount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
      } catch (e) {
        console.warn('[executeReceive] P2PK detection failed:', e instanceof Error ? e.message : e);
      }

      // Try history first, fall back to constructing from known data
      // to avoid race where history write hasn't flushed yet.
      const historyEntry = await findReceiveHistoryEntry(mgr, tokenString, mintUrl);
      if (historyEntry) return { historyEntry, hadP2PKProofs: hadP2PK };

      console.warn(
        '[executeReceive] History entry not found, building from token data | mintUrl:',
        mintUrl
      );
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
      console.info(
        '[executeMelt] Starting | mintUrl:',
        mintUrl,
        '| amount:',
        amount,
        '| target:',
        meltTarget.slice(0, 30) + '…'
      );

      const bolt11 = isLightningInvoiceBolt11(meltTarget)
        ? meltTarget
        : await requestInvoiceFromLnurl(meltTarget, amount);

      const operation = await mgr.ops.melt.prepare({
        mintUrl,
        method: 'bolt11',
        methodData: { invoice: bolt11 },
      });
      console.info('[executeMelt] Executing | operationId:', operation.id);
      const result = await mgr.ops.melt.execute(operation.id);
      console.info('[executeMelt] Complete | operationId:', result.id, '| state:', result.state);

      const entry = {
        id: result.id,
        type: 'melt' as const,
        createdAt: (result as any).createdAt ?? Date.now(),
        mintUrl: (result as any).mintUrl ?? mintUrl,
        unit: 'sat',
        quoteId: (result as any).quoteId ?? '',
        state: mapMeltOperationState(result.state),
        amount: (result as any).amount ?? amount,
        metadata: { operationId: result.id, meltTarget },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    rollbackMelt: async (operationId) => {
      const mgr = requireManager();
      console.info('[rollbackMelt] Cancelling | operationId:', operationId);
      await mgr.ops.melt.cancel(operationId, 'User cancelled');
      console.info('[rollbackMelt] Cancelled | operationId:', operationId);
    },

    buildMintReviewInfo: async (mintUrl, item): Promise<MintReviewInfo> => {
      const mgr = requireManager();
      const [mintInfo, balancesByMint, isTrusted] = await Promise.all([
        mgr.mint.getMintInfo(mintUrl).catch((e) => {
          console.warn(
            '[buildMintReviewInfo] getMintInfo failed for',
            mintUrl,
            e instanceof Error ? e.message : e
          );
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
      console.info('[executePaymentRequest] Starting | mintUrl:', mintUrl, '| amount:', amount);

      const info = defaultDetectors.getPaymentRequestInfo(paymentRequest);
      if (!info) {
        console.warn(
          '[executePaymentRequest] Failed to parse payment request:',
          paymentRequest.slice(0, 60)
        );
        throw new Error('Invalid payment request');
      }

      const nostrTransport = info.transports?.find((t) => t.type === 'nostr');
      const httpTransport = info.transports?.find((t) => t.type === 'post');

      let operationId: string;

      if (nostrTransport && !httpTransport) {
        console.info('[executePaymentRequest] Using Nostr transport');
        // Nostr transport: use ops.send directly since PaymentRequestsApi doesn't support Nostr
        const sendNostrDM = config.sendNostrDM;
        if (!sendNostrDM) {
          console.warn(
            '[executePaymentRequest] sendNostrDM not configured for Nostr payment request'
          );
          throw new Error('sendNostrDM operation is required for Nostr payment requests');
        }

        const effectiveAmount = info.amount ?? amount;
        if (!effectiveAmount) {
          console.warn('[executePaymentRequest] No amount provided for Nostr payment request');
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
          console.info('[executePaymentRequest] Nostr DM sent | operationId:', operationId);
        } catch (deliveryErr) {
          console.warn(
            '[executePaymentRequest] Nostr delivery failed | operationId:',
            operationId,
            deliveryErr instanceof Error ? deliveryErr.message : deliveryErr
          );
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
        console.info('[executePaymentRequest] Using HTTP transport');
        // HTTP or inband transport: use paymentRequests API
        const parsed = await mgr.paymentRequests.parse(paymentRequest);
        const transaction = await mgr.paymentRequests.prepare(parsed, { mintUrl, amount });
        operationId = transaction.sendOperation.id;
        try {
          if (config.shouldMockFailPaymentRequest?.()) {
            throw new Error('Mock delivery failure (dev)');
          }
          await mgr.paymentRequests.execute(transaction);
          console.info(
            '[executePaymentRequest] HTTP payment request executed | operationId:',
            operationId
          );
        } catch (deliveryErr) {
          console.warn(
            '[executePaymentRequest] HTTP delivery failed | operationId:',
            operationId,
            deliveryErr instanceof Error ? deliveryErr.message : deliveryErr
          );
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
      console.info(
        '[executePaymentRequest] Done | operationId:',
        operationId,
        '| transport:',
        nostrTransport ? 'nostr' : 'http'
      );
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
