/**
 * Debug balance panel that shows proof state breakdown and recovery actions.
 * Placed on the home screen between the balance area and the transaction list.
 * Tap the summary badges to expand into a full operations / recovery view.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useBalanceContext, useMints, useManager } from 'coco-cashu-react';
import { Text } from 'components/ui/Text';
import { CocoManager } from 'helper/coco/manager';
import type { CoreProof } from 'coco-cashu-core';

// ─── Types for the unsafe manager cast ───────────────────────────────────────

type UnsafeRepo = {
  getReadyProofs: (url: string) => Promise<CoreProof[]>;
  getAvailableProofs: (url: string) => Promise<CoreProof[]>;
  getReservedProofs: () => Promise<CoreProof[]>;
  getInflightProofs: (urls?: string[]) => Promise<CoreProof[]>;
  releaseProofs: (url: string, secrets: string[]) => Promise<void>;
};

type MeltOp = {
  id: string;
  state: string;
  mintUrl: string;
  method: string;
  quoteId?: string;
};

type UnsafeMeltSvc = {
  getOperation: (id: string) => Promise<MeltOp | null>;
  rollback: (id: string, reason?: string) => Promise<void>;
  recoverPendingOperations: () => Promise<void>;
  checkPendingOperation: (id: string) => Promise<string>;
};

type UnsafeProofSvc = {
  checkInflightProofs: () => Promise<void>;
  restoreProofsToReady: (mintUrl: string, secrets: string[]) => Promise<void>;
  releaseProofs: (mintUrl: string, secrets: string[]) => Promise<void>;
};

type UnsafeManager = {
  proofRepository?: UnsafeRepo;
  proofService?: UnsafeProofSvc;
  meltOperationService?: UnsafeMeltSvc;
  sendOperationService?: { recoverPendingOperations: () => Promise<void> };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sumProofs = (proofs: CoreProof[]): number => proofs.reduce((acc, p) => acc + p.amount, 0);

function truncateUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.length > 30 ? url.slice(0, 27) + '...' : url;
  }
}

function groupByOperation(
  proofs: { mintUrl: string; secret: string; amount: number; usedByOperationId?: string }[]
): [string, typeof proofs][] {
  const map = new Map<string, typeof proofs>();
  for (const p of proofs) {
    const key = p.usedByOperationId ?? 'none';
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return Array.from(map.entries());
}

function groupByMint(
  proofs: { mintUrl: string; secret: string; amount: number }[]
): [string, typeof proofs][] {
  const map = new Map<string, typeof proofs>();
  for (const p of proofs) {
    const list = map.get(p.mintUrl) ?? [];
    list.push(p);
    map.set(p.mintUrl, list);
  }
  return Array.from(map.entries());
}

// ─── Debug Balances Hook ─────────────────────────────────────────────────────

interface DebugBalances {
  ready: number;
  available: number;
  reserved: number;
  inflight: number;
  reservedProofs: {
    mintUrl: string;
    secret: string;
    amount: number;
    usedByOperationId?: string;
  }[];
  inflightProofs: { mintUrl: string; secret: string; amount: number }[];
}

function useDebugBalances(mints: { mintUrl: string }[]): DebugBalances | null {
  const manager = useManager();
  const { balance: liveBalances } = useBalanceContext();
  const [debug, setDebug] = useState<DebugBalances | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const repo = (manager as unknown as UnsafeManager).proofRepository;
        if (!repo) return;

        const mintUrls = mints.map((m) => m.mintUrl);

        const [readyPerMint, availablePerMint, allReserved, allInflight] = await Promise.all([
          Promise.all(mintUrls.map((url) => repo.getReadyProofs(url))),
          Promise.all(mintUrls.map((url) => repo.getAvailableProofs(url))),
          repo.getReservedProofs(),
          repo.getInflightProofs(mintUrls),
        ]);

        if (cancelled) return;

        setDebug({
          ready: readyPerMint.reduce((t, p) => t + sumProofs(p), 0),
          available: availablePerMint.reduce((t, p) => t + sumProofs(p), 0),
          reserved: sumProofs(allReserved as CoreProof[]),
          inflight: sumProofs(allInflight),
          reservedProofs: (allReserved as (CoreProof & { usedByOperationId?: string })[]).map(
            (p) => ({
              mintUrl: p.mintUrl,
              secret: p.secret,
              amount: p.amount,
              usedByOperationId: p.usedByOperationId,
            })
          ),
          inflightProofs: allInflight.map((p) => ({
            mintUrl: p.mintUrl,
            secret: p.secret,
            amount: p.amount,
          })),
        });
      } catch (err) {
        console.warn('Debug balances fetch failed:', err);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [manager, mints, liveBalances]);

  return debug;
}

// ─── Debug Operations Hook ───────────────────────────────────────────────────

interface DebugOperations {
  meltOps: MeltOp[];
  meltOpsByState: Record<string, MeltOp[]>;
}

function useDebugOperations(expanded: boolean): DebugOperations | null {
  const manager = useManager();
  const { balance: liveBalances } = useBalanceContext();
  const [ops, setOps] = useState<DebugOperations | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;

    const load = async () => {
      try {
        const meltRepo = (
          manager as unknown as {
            meltOperationRepository?: {
              getByState: (state: string) => Promise<MeltOp[]>;
            };
          }
        ).meltOperationRepository;
        if (!meltRepo) return;

        const states = [
          'init',
          'prepared',
          'executing',
          'pending',
          'finalized',
          'rolling_back',
          'rolled_back',
        ];
        const results = await Promise.all(states.map((s) => meltRepo.getByState(s)));

        if (cancelled) return;

        const allOps = results.flat();
        const byState: Record<string, MeltOp[]> = {};
        for (const op of allOps) {
          if (!byState[op.state]) byState[op.state] = [];
          byState[op.state].push(op);
        }

        setOps({ meltOps: allOps, meltOpsByState: byState });
      } catch (err) {
        console.warn('Debug operations fetch failed:', err);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [manager, expanded, liveBalances]);

  return ops;
}

// ─── Colours ─────────────────────────────────────────────────────────────────

const PANEL_BG = 'rgba(0,0,0,0.55)';
const ROW_BG = 'rgba(255,255,255,0.06)';
const BTN_BG = 'rgba(255,255,255,0.10)';
const WHITE60 = 'rgba(255,255,255,0.6)';
const WHITE40 = 'rgba(255,255,255,0.4)';
const WHITE = '#fff';

const STATE_COLORS: Record<string, string> = {
  init: '#94a3b8',
  prepared: '#60a5fa',
  executing: '#c084fc',
  pending: '#fb923c',
  finalized: '#4ade80',
  rolling_back: '#f87171',
  rolled_back: '#ef4444',
};

// ─── Public Component ────────────────────────────────────────────────────────

export function DebugBalancePanel(): React.ReactElement | null {
  const { mints } = useMints();
  const [expanded, setExpanded] = useState(false);
  const debugBalances = useDebugBalances(mints);
  const debugOps = useDebugOperations(expanded);

  if (!debugBalances) return null;

  return (
    <VStack gap={8} style={{ paddingHorizontal: 16, paddingTop: 4 }}>
      {/* Summary badges — tap to expand */}
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <HStack
          gap={12}
          justify="center"
          style={{
            backgroundColor: PANEL_BG,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}>
          <DebugBadge label="Ready" value={debugBalances.ready} color="#4ade80" />
          <DebugBadge label="Avail" value={debugBalances.available} color="#60a5fa" />
          <DebugBadge label="Rsrvd" value={debugBalances.reserved} color="#facc15" />
          <DebugBadge label="Flight" value={debugBalances.inflight} color="#fb923c" />
          <VStack align="center" justify="center">
            <Text size={10} style={{ color: WHITE40 }}>
              {expanded ? '▲' : '▼'}
            </Text>
          </VStack>
        </HStack>
      </TouchableOpacity>

      {/* Expanded panel */}
      {expanded && (
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator nestedScrollEnabled>
          <ExpandedPanel debugBalances={debugBalances} debugOps={debugOps} />
        </ScrollView>
      )}
    </VStack>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function DebugBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <VStack align="center" gap={2}>
      <Text size={9} weight="medium" style={{ color: WHITE60 }}>
        {label}
      </Text>
      <Text size={11} weight="bold" style={{ color }}>
        {value}
      </Text>
    </VStack>
  );
}

// ─── Expanded Panel ──────────────────────────────────────────────────────────

function ExpandedPanel({
  debugBalances,
  debugOps,
}: {
  debugBalances: DebugBalances;
  debugOps: DebugOperations | null;
}) {
  const manager = useManager();
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<string>) => {
      if (busy) return;
      setBusy(key);
      setLastResult(null);
      try {
        const msg = await fn();
        setLastResult(msg);
      } catch (err) {
        setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [busy]
  );

  // ── Actions ──

  const handleFreeReserved = () =>
    runAction('free-reserved', async () => {
      const r = await CocoManager.freeAllReservedProofs();
      return (
        `Freed: ${r.totalReservedProofs} proofs, ` +
        `${r.rolledBackSendOperations} send, ` +
        `${r.rolledBackMeltOperations} melt, ` +
        `${r.releasedOrphanedReservations} orphans` +
        (r.errors.length > 0 ? `, ${r.errors.length} errors` : '')
      );
    });

  const handleCheckInflight = () =>
    runAction('check-inflight', async () => {
      const svc = (manager as unknown as UnsafeManager).proofService;
      if (!svc?.checkInflightProofs) throw new Error('checkInflightProofs unavailable');
      await svc.checkInflightProofs();
      return 'Inflight proofs checked against mints';
    });

  const handleRestoreInflight = () =>
    runAction('restore-inflight', async () => {
      const svc = (manager as unknown as UnsafeManager).proofService;
      if (!svc?.restoreProofsToReady) throw new Error('restoreProofsToReady unavailable');
      const proofs = debugBalances.inflightProofs;
      if (proofs.length === 0) return 'No inflight proofs to restore';
      const byMint = new Map<string, string[]>();
      for (const p of proofs) {
        const list = byMint.get(p.mintUrl) ?? [];
        list.push(p.secret);
        byMint.set(p.mintUrl, list);
      }
      let count = 0;
      for (const [mintUrl, secrets] of byMint.entries()) {
        await svc.restoreProofsToReady(mintUrl, secrets);
        count += secrets.length;
      }
      return `Restored ${count} inflight proofs to ready`;
    });

  const handleRecoverMelts = () =>
    runAction('recover-melts', async () => {
      const svc = (manager as unknown as UnsafeManager).meltOperationService;
      if (!svc?.recoverPendingOperations) throw new Error('recoverPendingOperations unavailable');
      await svc.recoverPendingOperations();
      return 'Melt operation recovery complete';
    });

  const handleRecoverSends = () =>
    runAction('recover-sends', async () => {
      const svc = (manager as unknown as UnsafeManager).sendOperationService;
      if (!svc?.recoverPendingOperations) throw new Error('recoverPendingOperations unavailable');
      await svc.recoverPendingOperations();
      return 'Send operation recovery complete';
    });

  const handleCheckPendingMelt = (opId: string) =>
    runAction(`check-${opId}`, async () => {
      const svc = (manager as unknown as UnsafeManager).meltOperationService;
      if (!svc?.checkPendingOperation) throw new Error('checkPendingOperation unavailable');
      const decision = await svc.checkPendingOperation(opId);
      return `${opId.slice(0, 8)}… → ${decision}`;
    });

  const handleRollbackMelt = (opId: string) =>
    runAction(`rollback-${opId}`, async () => {
      const svc = (manager as unknown as UnsafeManager).meltOperationService;
      if (!svc?.rollback) throw new Error('rollback unavailable');
      await svc.rollback(opId, 'Manual rollback via debug panel');
      return `${opId.slice(0, 8)}… rolled back`;
    });

  // ── Active (non-terminal) operations ──
  const activeStates = ['init', 'prepared', 'executing', 'pending', 'rolling_back'];
  const activeOps = debugOps ? activeStates.flatMap((s) => debugOps.meltOpsByState[s] ?? []) : [];

  return (
    <VStack
      gap={8}
      style={{
        backgroundColor: PANEL_BG,
        borderRadius: 12,
        padding: 12,
      }}>
      {/* ── Reserved proofs ── */}
      {debugBalances.reservedProofs.length > 0 && (
        <VStack gap={4}>
          <Text size={10} weight="bold" style={{ color: '#facc15' }}>
            RESERVED PROOFS ({debugBalances.reservedProofs.length})
          </Text>
          {groupByOperation(debugBalances.reservedProofs).map(([opId, proofs]) => (
            <HStack
              key={opId}
              gap={6}
              align="center"
              style={{
                backgroundColor: ROW_BG,
                borderRadius: 6,
                padding: 6,
              }}>
              <VStack gap={1} style={{ flex: 1 }}>
                <Text size={9} style={{ color: WHITE60 }}>
                  op: {opId === 'none' ? '(orphan)' : opId.slice(0, 12) + '…'}
                </Text>
                <Text size={10} weight="bold" style={{ color: '#facc15' }}>
                  {proofs.reduce((s, p) => s + p.amount, 0)} sat ({proofs.length} proofs)
                </Text>
              </VStack>
            </HStack>
          ))}
        </VStack>
      )}

      {/* ── Inflight proofs ── */}
      {debugBalances.inflightProofs.length > 0 && (
        <VStack gap={4}>
          <Text size={10} weight="bold" style={{ color: '#fb923c' }}>
            INFLIGHT PROOFS ({debugBalances.inflightProofs.length})
          </Text>
          {groupByMint(debugBalances.inflightProofs).map(([mintUrl, proofs]) => (
            <HStack
              key={mintUrl}
              gap={6}
              align="center"
              style={{
                backgroundColor: ROW_BG,
                borderRadius: 6,
                padding: 6,
              }}>
              <VStack gap={1} style={{ flex: 1 }}>
                <Text size={9} style={{ color: WHITE60 }}>
                  {truncateUrl(mintUrl)}
                </Text>
                <Text size={10} weight="bold" style={{ color: '#fb923c' }}>
                  {proofs.reduce((s, p) => s + p.amount, 0)} sat ({proofs.length} proofs)
                </Text>
              </VStack>
            </HStack>
          ))}
        </VStack>
      )}

      {/* ── Active melt operations ── */}
      {activeOps.length > 0 && (
        <VStack gap={4}>
          <Text size={10} weight="bold" style={{ color: WHITE }}>
            MELT OPERATIONS ({activeOps.length} active)
          </Text>
          {activeOps.map((op) => (
            <VStack
              key={op.id}
              gap={4}
              style={{
                backgroundColor: ROW_BG,
                borderRadius: 6,
                padding: 6,
              }}>
              <HStack gap={6} align="center">
                <VStack gap={1} style={{ flex: 1 }}>
                  <HStack gap={4} align="center">
                    <Text
                      size={9}
                      weight="bold"
                      style={{
                        color: STATE_COLORS[op.state] ?? WHITE60,
                      }}>
                      {op.state.toUpperCase()}
                    </Text>
                    <Text size={9} style={{ color: WHITE40 }}>
                      {op.id.slice(0, 12)}…
                    </Text>
                  </HStack>
                  <Text size={9} style={{ color: WHITE40 }}>
                    {truncateUrl(op.mintUrl)}
                  </Text>
                </VStack>
              </HStack>
              {/* Per-op actions */}
              <HStack gap={4}>
                {op.state === 'pending' && (
                  <>
                    <ActionChip
                      label="Check"
                      color="#60a5fa"
                      busy={busy === `check-${op.id}`}
                      onPress={() => handleCheckPendingMelt(op.id)}
                    />
                    <ActionChip
                      label="Rollback"
                      color="#f87171"
                      busy={busy === `rollback-${op.id}`}
                      onPress={() => handleRollbackMelt(op.id)}
                    />
                  </>
                )}
                {(op.state === 'prepared' || op.state === 'rolling_back') && (
                  <ActionChip
                    label="Rollback"
                    color="#f87171"
                    busy={busy === `rollback-${op.id}`}
                    onPress={() => handleRollbackMelt(op.id)}
                  />
                )}
              </HStack>
            </VStack>
          ))}
        </VStack>
      )}

      {/* ── Quick actions ── */}
      <VStack gap={4}>
        <Text size={10} weight="bold" style={{ color: WHITE }}>
          RECOVERY ACTIONS
        </Text>
        <HStack gap={4} style={{ flexWrap: 'wrap' }}>
          <ActionChip
            label="Free Reserved"
            color="#facc15"
            busy={busy === 'free-reserved'}
            onPress={handleFreeReserved}
          />
          <ActionChip
            label="Check Inflight"
            color="#fb923c"
            busy={busy === 'check-inflight'}
            onPress={handleCheckInflight}
          />
          <ActionChip
            label="Restore Inflight"
            color="#fb923c"
            busy={busy === 'restore-inflight'}
            onPress={handleRestoreInflight}
          />
          <ActionChip
            label="Recover Melts"
            color="#c084fc"
            busy={busy === 'recover-melts'}
            onPress={handleRecoverMelts}
          />
          <ActionChip
            label="Recover Sends"
            color="#60a5fa"
            busy={busy === 'recover-sends'}
            onPress={handleRecoverSends}
          />
        </HStack>
      </VStack>

      {/* ── Last result ── */}
      {lastResult && (
        <Text
          size={9}
          style={{
            color: lastResult.startsWith('Error') ? '#f87171' : '#4ade80',
            textAlign: 'center',
          }}>
          {lastResult}
        </Text>
      )}
    </VStack>
  );
}

// ─── Action Chip ─────────────────────────────────────────────────────────────

function ActionChip({
  label,
  color,
  busy,
  onPress,
}: {
  label: string;
  color: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={{
        backgroundColor: BTN_BG,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: color + '40',
        opacity: busy ? 0.5 : 1,
      }}>
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Text size={9} weight="bold" style={{ color }}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}
