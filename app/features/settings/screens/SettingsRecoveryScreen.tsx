import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { clearGlassHeaderLeftItems } from '@/navigation/headerItems';
import { SlideToConfirm } from '@/shared/ui/composed/SlideToConfirm';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Switch, Button, Card } from 'heroui-native';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useMintManagement } from '@/features/mint';
import { useNavigation } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Mint } from '@cashu/coco-core';
import { useBalanceContext } from '@cashu/coco-react';
import {
  deleteMintOperation,
  restoreKeysetForMint,
  isRestorableKeysetId,
  isAlreadyRecoveredError,
  probeMintForHistory,
} from '@/shared/lib/cashu/managerInternals';
import { withTimeout } from 'wallet';
import {
  beginRecoverySuppression,
  endRecoverySuppression,
} from '@/shared/lib/cashu/recoverySuppression';
import {
  isNativeCryptoAvailable,
  setNativeCryptoEnabled,
} from '@/shared/lib/cashu/nativeOutputDataCreator';
import { runCryptoMicroBench } from '@/shared/lib/cashu/cryptoMicroBench';
import {
  beginRecoveryBenchmark,
  endRecoveryBenchmark,
  markMintStart,
  recordFinalizePhase,
  recordMintBenchmark,
  recordProbePhase,
} from '@/shared/lib/cashu/recoveryBenchmark';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { ElapsedSeconds } from '@/shared/ui/composed/ElapsedSeconds';
import {
  computeRecoveryCounts,
  countKnownFailures,
  createInitialMintStates,
  currentMint,
  currentMintPosition,
  describeMintProgress,
  isSuccess,
  mintStatusToCheckpoint,
  type MintRecoveryState,
  type RecoveryPhase,
} from '@/features/settings/lib/recoveryProgress';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { LoadingIndicator, mapCheckpointStatusToIndicator } from '@/shared/blocks/status';
import {
  DOT_SIZE,
  STROKE_PX,
  rowDelays,
} from '@/features/transactions/components/detail/timeline/timelineTheme';
import { staticPopup, paramPopup } from '@/shared/lib/popup';
import { fetchJson } from '@/shared/lib/apiClient';
import { MintListResponse, parseWith } from '@sovranbitcoin/schemas';

// ─── Deep probe: discover mints from audit API ─────────────────────────────

const SOVRAN_MINTS_API = 'https://api.sovran.money/api/cashu/mints';
const MAX_DISCOVERED_MINTS = 100;

const parseMintList = parseWith(MintListResponse, 'cashu/mints');

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function normalizeMintUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

// Hostname allowlist for backend-supplied mint URLs. Every admitted host
// will be probed by `wallet.restore`, which sends the user's IP and derived
// blinded messages — a compromised api.sovran.money response (or CDN MITM)
// must not aim the wallet at LAN, loopback, link-local, or `.onion` hosts.
function isAllowedMintHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return false;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.onion')) return false;
  // Block bare IPs entirely — public mints are reached by hostname.
  // `URL.hostname` strips brackets from IPv6 literals, leaving colons.
  if (h.includes(':')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return true;
}

async function fetchDiscoveredMintUrls(
  knownUrls: string[],
  signal?: AbortSignal
): Promise<string[]> {
  const known = new Set(knownUrls.map(normalizeMintUrl));
  const result = await fetchJson(SOVRAN_MINTS_API, parseMintList, 'cashu/mints', undefined, {
    signal,
  });
  if (result.isErr()) return [];
  const admitted: string[] = [];
  let rejectedHost = 0;
  let rejectedScheme = 0;
  let rejectedMalformed = 0;
  for (const raw of result.value) {
    if (admitted.length >= MAX_DISCOVERED_MINTS) break;
    if (!raw.startsWith('https://')) {
      rejectedScheme++;
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      rejectedMalformed++;
      continue;
    }
    if (!isAllowedMintHost(parsed.hostname)) {
      rejectedHost++;
      continue;
    }
    const normalized = raw.replace(/\/$/, '');
    if (known.has(normalized.toLowerCase())) continue;
    admitted.push(normalized);
  }
  cashuLog.info('recovery.discover.admitted', {
    admittedCount: admitted.length,
    rejectedHost,
    rejectedScheme,
    rejectedMalformed,
    totalReturned: result.value.length,
  });
  return admitted;
}

/** Phases where the run is doing work and must not be interrupted. */
const ACTIVE_PHASES: ReadonlySet<RecoveryPhase> = new Set<RecoveryPhase>([
  'discovering',
  'restoring',
  'finalizing',
]);

/** A mint that stops answering must not strand the whole (now serial) run. */
const MINT_RESTORE_TIMEOUT_MS = 120_000;

/** Probed mints get one cheap batch to prove they hold anything at all. */
const PROBE_CONCURRENCY = 4;

/**
 * Module-scoped, deliberately not React state.
 *
 * Two full recoveries once ran concurrently on-device (two `recovery.start`,
 * each taking ~180s instead of ~100s) because the screen remounted — a Metro
 * reload, or AppGate re-rendering — and remounting resets any state- or
 * ref-based guard back to "idle". Module scope is the only thing that survives
 * that, and running two restores against one wallet database races counters.
 */
let recoveryInFlight = false;

/** Set when the user cancels; checked between mints and between keysets. */
let recoveryCancelled = false;

/**
 * Benchmark preference, module-scoped for the same reason as the guard above:
 * this screen remounts constantly (AppGate re-render, navigation, a Metro
 * reload), and as component state the switch silently snapped back to native
 * between flipping it and swiping — which is why four "A/B" runs all came out
 * `cdk-native`. Survives a remount; a full JS reload still resets it to the
 * default, which is the honest default anyway.
 */
let preferNativeCrypto = true;

/**
 * Hand the thread back so timers fire and React can paint.
 *
 * A `setTimeout` and not `queueMicrotask`/`await null`: restore's cost lands as
 * promise continuations, and microtasks drain fully before the timer queue, so
 * four batches' worth of unblinding chain back-to-back into one 34-second block.
 * Only a macrotask boundary actually breaks that chain.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Main screen ────────────────────────────────────────────────────────────

interface SettingsRecoveryScreenProps {
  /**
   * When true, renders without the Cancel button and without manipulating
   * navigation options — the screen is a forced gate (rendered inline by
   * AppGate when `seedCreatedAt` is null), not a route the user can dismiss.
   */
  gateMode?: boolean;
  /**
   * Fires when the user confirms the completed recovery. In `gateMode`, AppGate
   * uses this to mark `restoreStatus = 'complete'` so the gate falls through
   * and the rest of the app mounts. In normal usage this is undefined and the
   * screen falls back to `router.back()` via its own Close button.
   */
  onComplete?: () => void;
}

export const SettingsRecoveryScreen: React.FC<SettingsRecoveryScreenProps> = ({
  gateMode = false,
  onComplete,
}) => {
  useLifecycleLogger('SettingsRecoveryScreen');
  const [foreground, mutedColor, successColor, dangerColor, warningColor, surfaceSecondary] =
    useThemeColor([
      'foreground',
      'muted',
      'success',
      'danger',
      'warning',
      'surface-secondary',
    ] as const);
  const navigation = useNavigation();
  const { mints, loadMints } = useMintManagement();

  const [phase, setPhase] = useState<RecoveryPhase>('idle');
  const [results, setResults] = useState<MintRecoveryState[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Sublabel for the `finalizing` phase, so cleanup names the work it is doing. */
  const [finalizingLabel, setFinalizingLabel] = useState<string | null>(null);

  // Deep probe: also check mints from the audit API
  const [deepProbe, setDeepProbe] = useState(false);
  const [discoveredMintUrls, setDiscoveredMintUrls] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Benchmark switch. Defaults to native and only offered when the self-test
  // proved the two implementations byte-identical — flipping it is an A/B of
  // the same wallet, not a behaviour change.
  const [useNativeCrypto, setUseNativeCryptoState] = useState(preferNativeCrypto);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const nativeAvailable = isNativeCryptoAvailable();

  const setUseNativeCrypto = useCallback((next: boolean) => {
    // Write through to module scope so a remount cannot revert the choice, and
    // log the flip — otherwise a run that silently reverted looks identical to
    // one the user meant to run natively.
    preferNativeCrypto = next;
    setUseNativeCryptoState(next);
    cashuLog.info('recovery.native_crypto.preference', { useNativeCrypto: next });
  }, []);

  useEffect(() => {
    if (!deepProbe) {
      setDiscoveredMintUrls([]);
      return;
    }
    const controller = new AbortController();
    // Surfaced so the swipe can be held back: without this the user could
    // enable "Search all mints", swipe immediately, and get an empty probe
    // list with no indication anything was still loading.
    setIsDiscovering(true);
    void fetchDiscoveredMintUrls(
      mints.map((m) => m.mintUrl),
      controller.signal
    ).then((urls) => {
      if (controller.signal.aborted) return;
      setDiscoveredMintUrls(urls);
      setIsDiscovering(false);
    });
    return () => {
      controller.abort();
      setIsDiscovering(false);
    };
  }, [deepProbe, mints]);

  // Lock navigation when recovery is in progress.
  // Skipped in gateMode — the screen isn't mounted as a route at all, so
  // touching navigation options would target the wrong screen and the
  // beforeRemove listener has no event to prevent.
  useEffect(() => {
    if (gateMode) return;
    const isLocked = ACTIVE_PHASES.has(phase);
    navigation.setOptions({
      gestureEnabled: !isLocked,
      headerBackVisible: !isLocked,
      headerLeft: isLocked ? () => null : undefined,
      // Clear the flow's wrapped left item so recovery uses the NATIVE back
      // button (its beforeRemove guard depends on it) instead of rendering the
      // custom item alongside the native back (two backs).
      ...clearGlassHeaderLeftItems(),
    });
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isLocked) e.preventDefault();
    });
    return unsubscribe;
  }, [phase, navigation, gateMode]);

  const handleStartRecovery = useCallback(async () => {
    // Module-scoped, so a remount cannot reset it. Two concurrent recoveries
    // race the same counters and each takes ~1.8x as long.
    if (recoveryInFlight) {
      cashuLog.warn('recovery.start.rejected', { reason: 'already_in_flight' });
      return;
    }
    if (ACTIVE_PHASES.has(phase)) return;
    recoveryInFlight = true;
    recoveryCancelled = false;
    // Read the module variable, NOT the `useNativeCrypto` state: this callback
    // is memoised without it in the dependency list, so the closed-over value
    // is whatever it was on first render. That stale `true` is why a run made
    // right after switching the toggle off still came out `cdk-native`.
    setNativeCryptoEnabled(preferNativeCrypto);
    // Hold the app-wide refresh storm until the run is over — see the module
    // doc for what it costs when left on.
    beginRecoverySuppression();

    // Build the full list of mint URLs to restore
    const knownMintUrls = mints.map((m) => m.mintUrl);
    const probeCandidates = deepProbe ? discoveredMintUrls : [];

    if (knownMintUrls.length === 0 && probeCandidates.length === 0) {
      recoveryInFlight = false;
      staticPopup('recovery-failed', { text: 'No mints found to recover from. Add a mint first.' });
      return;
    }

    const t0 = performance.now();

    setErrorMessage(null);
    setFinalizingLabel(null);
    // Deliberately does NOT touch `restoreStatus`. Writing 'in-progress' here
    // locked users out of the app: AppGate blocks on that value, and a
    // Settings-initiated run has nothing that clears it afterwards, so every
    // subsequent launch booted straight into the recovery gate. It also bought
    // nothing — a kill mid-recovery leaves 'pending', and the gate re-showing
    // is the correct response to an interrupted recovery either way. Only the
    // gate owns this flag, via `onComplete`.

    let allMintUrls = knownMintUrls;
    let probeMintUrls: string[] = [];

    beginRecoveryBenchmark({
      knownMints: knownMintUrls.length,
      probeCandidates: probeCandidates.length,
    });

    try {
      const manager = CocoManager.getInstance();

      // Shallow probe pass. Ask each unknown mint one cheap question — does
      // this seed have anything here — instead of running a full gap walk over
      // every keyset of up to 100 mints. Empty probes produce no signatures and
      // therefore no unblinding, so these are safe to run a few at a time.
      if (probeCandidates.length > 0) {
        const probeT0 = performance.now();
        setPhase('discovering');
        setResults(createInitialMintStates(knownMintUrls, []));
        for (let start = 0; start < probeCandidates.length; start += PROBE_CONCURRENCY) {
          if (recoveryCancelled) break;
          const slice = probeCandidates.slice(start, start + PROBE_CONCURRENCY);
          setFinalizingLabel(
            `Checking ${Math.min(start + slice.length, probeCandidates.length)} of ${probeCandidates.length} mints`
          );
          const hits = await Promise.all(
            slice.map((url) =>
              probeMintForHistory(manager, url)
                .then((found) => (found ? url : null))
                .catch(() => null)
            )
          );
          probeMintUrls.push(...hits.filter((url): url is string => url != null));
          await yieldToEventLoop();
        }
        cashuLog.info('recovery.probe.done', {
          candidates: probeCandidates.length,
          hits: probeMintUrls.length,
        });
        recordProbePhase({
          hits: probeMintUrls.length,
          durationMs: performance.now() - probeT0,
        });
        allMintUrls = [...knownMintUrls, ...probeMintUrls];
      }

      setFinalizingLabel(null);
      setPhase('restoring');

      cashuLog.info('recovery.start', {
        mintCount: allMintUrls.length,
        knownMints: knownMintUrls.length,
        discoveredMints: probeMintUrls.length,
        probeCandidates: probeCandidates.length,
        deepProbe,
      });

      const recoveryResults = createInitialMintStates(knownMintUrls, probeMintUrls);
      setResults([...recoveryResults]);

      const patch = (i: number, next: Partial<MintRecoveryState>) => {
        recoveryResults[i] = { ...recoveryResults[i], ...next };
        setResults([...recoveryResults]);
      };

      /**
       * Per-mint NUT-07 tally, owned by the loop rather than by `restoreOneUrl`.
       * A mint that hits `MINT_RESTORE_TIMEOUT_MS` is abandoned partway through,
       * so its counts have to live somewhere the timeout handler can still read
       * them — otherwise the slowest mints, which are exactly the ones worth
       * measuring, contribute zeroes to the table.
       */
      const proofTally = { ready: 0, spent: 0 };

      const restoreOneUrl = async (mintUrl: string, i: number) => {
        const isDiscovered = i >= knownMintUrls.length;
        const mintT0 = performance.now();
        const cryptoAtMintStart = markMintStart();
        cashuLog.info('recovery.mint.start', {
          ...mintUrlLogFields(mintUrl),
          mintIndex: i,
          totalMints: allMintUrls.length,
          isDiscovered,
        });
        patch(i, { status: 'restoring', startedAtMs: Date.now() });

        // Drive coco's own restore loop keyset by keyset instead of calling
        // `wallet.restore(mintUrl)`. That call walks every keyset silently and
        // throws once at the end, so it can report neither how far along a mint
        // is nor which keyset failed — and a single mint can hold this screen
        // for over a minute.
        let failedKeysets = 0;
        let alreadyRecoveredKeysets = 0;
        let skippedKeysets = 0;
        let mintError: string | undefined;
        try {
          // Same call `wallet.restore` makes first, so this stays idempotent —
          // and it is the only way to learn the keyset count up front.
          const { keysets } = await manager.mint.addMint(mintUrl, { trusted: true });
          patch(i, { keysetsTotal: keysets.length });
          cashuLog.info('recovery.mint.keysets', {
            ...mintUrlLogFields(mintUrl),
            keysetCount: keysets.length,
          });

          for (const keyset of keysets) {
            if (recoveryCancelled) break;
            // Mirrors coco's normalizeUnit(keyset.unit ?? DEFAULT_UNIT).
            const unit = (keyset.unit ?? 'sat').toLowerCase();
            if (!isRestorableKeysetId(keyset.id)) {
              skippedKeysets += 1;
              cashuLog.info('recovery.keyset.skipped', {
                ...mintUrlLogFields(mintUrl),
                keysetId: keyset.id,
                reason: 'non_nut02_id',
              });
            } else {
              try {
                // `proofTally` is written through, not returned: this call
                // throws on the already-recovered path, which is precisely
                // where the interesting counts are.
                await restoreKeysetForMint(manager, mintUrl, keyset.id, unit, proofTally);
              } catch (error) {
                if (isAlreadyRecoveredError(error)) {
                  // Every proof was already in the database — a second run
                  // finding nothing new is success, not failure.
                  alreadyRecoveredKeysets += 1;
                  cashuLog.info('recovery.keyset.already_recovered', {
                    ...mintUrlLogFields(mintUrl),
                    keysetId: keyset.id,
                  });
                } else {
                  failedKeysets += 1;
                  cashuLog.warn('recovery.keyset.failed', {
                    ...mintUrlLogFields(mintUrl),
                    keysetId: keyset.id,
                    unit,
                    error: (error as Error)?.message,
                  });
                }
              }
            }
            patch(i, {
              keysetsDone: recoveryResults[i].keysetsDone + 1,
              failedKeysets,
              alreadyRecoveredKeysets,
              skippedKeysets,
            });
            // Between keysets, not inside them: unblinding a batch is one
            // uninterruptible JS turn, so this is the only place the thread
            // can be handed back.
            await yieldToEventLoop();
          }
        } catch (error) {
          // addMint failed — the mint is unreachable, so no keyset ran at all.
          failedKeysets = Math.max(failedKeysets, 1);
          mintError = (error as Error)?.message;
          cashuLog.warn('recovery.mint.restore_threw', {
            ...mintUrlLogFields(mintUrl),
            error: mintError,
          });
        }

        // Scoped to this mint. Unscoped, coco falls through to
        // `getAllReadyProofs` — a full ready-proof scan across every mint,
        // once per mint completion.
        const balances = await manager.wallet.balances
          .byMint({ mintUrls: [mintUrl] })
          .catch(() => ({}) as Awaited<ReturnType<typeof manager.wallet.balances.byMint>>);
        const mintBalance = amountToNumber(balances[mintUrl]?.total);
        const fundsFound = mintBalance > 0;
        const mintMs = Math.round((performance.now() - mintT0) * 100) / 100;

        const restoredSomething = alreadyRecoveredKeysets === 0 || failedKeysets > 0;
        const mintStatus =
          failedKeysets > 0 ? 'failed' : restoredSomething ? 'done' : 'already-recovered';
        recordMintBenchmark(
          {
            mintUrl,
            isDiscovered,
            status: mintStatus,
            keysetsTotal: recoveryResults[i]!.keysetsTotal ?? 0,
            keysetsAttempted: recoveryResults[i]!.keysetsDone - skippedKeysets,
            keysetsSkipped: skippedKeysets,
            keysetsAlreadyRecovered: alreadyRecoveredKeysets,
            keysetsFailed: failedKeysets,
            durationMs: performance.now() - mintT0,
            proofsReady: proofTally.ready,
            proofsSpent: proofTally.spent,
          },
          cryptoAtMintStart
        );
        patch(i, {
          // Report what actually happened. This used to be an unconditional
          // `success: true`, which made "Recovery Partial" dead code and let
          // the screen claim it recovered from every mint while restore threw.
          status: mintStatus,
          error: failedKeysets > 0 ? (mintError ?? `${failedKeysets} keyset(s) failed`) : undefined,
          durationMs: mintMs,
          fundsFound,
        });
        cashuLog.info('recovery.mint.done', {
          ...mintUrlLogFields(mintUrl),
          durationMs: mintMs,
          failedKeysets,
          alreadyRecoveredKeysets,
          skippedKeysets,
          fundsFound,
        });
      };

      // ONE MINT AT A TIME.
      //
      // This used to be `Promise.allSettled(allMintUrls.map(...))`. Every other
      // Cashu wallet — cashu.me, macadamia, minibits — and CDK's own Rust
      // restore run mints strictly sequentially, and the measured reason is
      // stark: with N mints in flight, cashu-ts's 4-way in-keyset batch pool
      // becomes 4N concurrent responses whose unblinding drains as one
      // unbroken microtask chain. On-device that produced 34s and 39s JS
      // blocks, and it punished the innocent — the two mints that restored
      // NOTHING still took 35s each, with request latency up to 56s, purely
      // from contention. Network concurrency inside a keyset is kept, because
      // that part is bounded and not CPU-bound.
      for (let i = 0; i < allMintUrls.length; i += 1) {
        if (recoveryCancelled) {
          patch(i, { status: 'skipped', error: 'Cancelled' });
          continue;
        }
        const timeoutT0 = performance.now();
        const cryptoBeforeMint = markMintStart();
        proofTally.ready = 0;
        proofTally.spent = 0;
        try {
          await withTimeout(
            restoreOneUrl(allMintUrls[i]!, i),
            MINT_RESTORE_TIMEOUT_MS,
            'recovery.mint'
          );
        } catch (error) {
          // coco's request provider has no HTTP timeout, so one unresponsive
          // mint would otherwise stall every mint behind it.
          patch(i, {
            status: 'failed',
            error: (error as Error)?.message ?? 'Timed out',
            durationMs: null,
          });
          // Record it here too: `restoreOneUrl`'s own benchmark call never runs
          // when the timeout fires, and without this the mint vanishes from the
          // per-mint table — a run that touched five mints reported four, which
          // made the two implementations look like different workloads even
          // though the run-level counters matched exactly.
          recordMintBenchmark(
            {
              mintUrl: allMintUrls[i]!,
              isDiscovered: i >= knownMintUrls.length,
              status: 'timed-out',
              keysetsTotal: recoveryResults[i]?.keysetsTotal ?? 0,
              keysetsAttempted: recoveryResults[i]?.keysetsDone ?? 0,
              keysetsSkipped: recoveryResults[i]?.skippedKeysets ?? 0,
              keysetsAlreadyRecovered: recoveryResults[i]?.alreadyRecoveredKeysets ?? 0,
              keysetsFailed: recoveryResults[i]?.failedKeysets ?? 0,
              durationMs: performance.now() - timeoutT0,
              proofsReady: proofTally.ready,
              proofsSpent: proofTally.spent,
            },
            cryptoBeforeMint
          );
          cashuLog.warn('recovery.mint.timed_out', {
            ...mintUrlLogFields(allMintUrls[i]),
            timeoutMs: MINT_RESTORE_TIMEOUT_MS,
          });
        }
      }

      // Everything below is real work that used to run under the "Recovering
      // Wallet" spinner with every mint row already showing its green check —
      // the "idle spinner near the end". It gets its own phase and copy.
      const finalizeT0 = performance.now();
      setPhase('finalizing');

      // Untrust discovered mints that returned no funds. `wallet.restore`
      // calls `mintService.addMintByUrl(url, { trusted: true })` for every
      // probed URL (see ../coco/packages/core/api/WalletApi.ts), which would
      // otherwise leave attacker-supplied URLs from the audit API permanently
      // in the trusted-mints set used by the routing surface.
      const discoveredEmpty = recoveryResults.filter((r) => r.isDiscovered && !r.fundsFound);
      if (discoveredEmpty.length > 0) {
        setFinalizingLabel(`Tidying up ${discoveredEmpty.length} probed mints`);
        await Promise.allSettled(
          discoveredEmpty.map(async (r) => {
            try {
              await manager.mint.untrustMint(r.mint);
              cashuLog.info('recovery.cleanup.discovered_mint_untrusted', {
                ...mintUrlLogFields(r.mint),
              });
            } catch (e) {
              cashuLog.warn('recovery.cleanup.untrust_failed', {
                ...mintUrlLogFields(r.mint),
                error: (e as Error)?.message,
              });
            }
          })
        );
      }

      // Clean up stuck pending mint operations from before the restore.
      // These were queued (typically by NPC sync) when the wallet's
      // deterministic counter was out of sync with the mint, so their
      // outputData was generated against a counter the mint had already
      // signed. They will fail forever with `outputs already signed` and
      // re-loop via the operation watcher. The proofs themselves were
      // recovered by batchRestore above, so dropping these stale operations
      // is non-destructive.
      try {
        const pendingOps = await manager.ops.mint.listPending();
        if (pendingOps.length > 0) {
          setFinalizingLabel(`Clearing ${pendingOps.length} stale operations`);
          // Coco doesn't expose a public abandon API for pending operations,
          // so go through the typed seam in shared/lib/cashu/managerInternals.
          for (const op of pendingOps) {
            await deleteMintOperation(manager, op.id).catch((e) =>
              cashuLog.warn('recovery.cleanup.delete_failed', {
                operationId: op.id,
                ...mintUrlLogFields(op.mintUrl),
                error: (e as Error)?.message,
              })
            );
          }
          cashuLog.info('recovery.cleanup.dropped_stuck_pending_ops', {
            count: pendingOps.length,
            operationIds: pendingOps.map((o) => o.id),
          });
        }
      } catch (cleanupErr) {
        cashuLog.warn('recovery.cleanup.failed', {
          error: (cleanupErr as Error)?.message,
        });
      }

      setFinalizingLabel('Refreshing your mints');
      await loadMints();
      recordFinalizePhase(performance.now() - finalizeT0);
      const totalMs = Math.round((performance.now() - t0) * 100) / 100;
      const counts = computeRecoveryCounts(recoveryResults);
      const successCount = counts.succeeded;
      // Only count failures on known mints — discovered mint failures are expected
      const knownFailureCount = countKnownFailures(recoveryResults);

      cashuLog.info('recovery.complete', {
        totalMs,
        successCount,
        knownFailureCount,
        failedMints: counts.failed,
        totalResults: recoveryResults.length,
      });

      if (knownFailureCount === 0) {
        // Gate-mode owns its own UI through to AppGate's transition (SOV-00 §8).
        // The runtime popupStore survives a gate→app remount, so a toast pushed
        // here would render over the freshly-mounted wallet. The inline
        // `renderCompleteState` already provides feedback in gate mode.
        if (!gateMode) {
          paramPopup('recovery-success', {
            mintCount: successCount,
            durationSec: (totalMs / 1000).toFixed(1),
          });
        }
        setPhase('complete');
      } else {
        if (!gateMode) {
          if (successCount > 0) {
            paramPopup('recovery-partial', { successCount, failureCount: knownFailureCount });
          } else {
            staticPopup('recovery-failed');
          }
        }
        setPhase('error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      if (!gateMode) {
        staticPopup('recovery-failed', { text: errorMsg });
      }
      setPhase('error');
    } finally {
      setFinalizingLabel(null);
      recoveryInFlight = false;
      // Always emits, including on the error path — a failed run's numbers are
      // exactly the ones worth reading.
      endRecoveryBenchmark();
      // Replays one refresh per subscriber. Must run before `loadMints` below
      // would otherwise be the only thing that repopulated the screen.
      endRecoverySuppression();
    }
  }, [phase, mints, deepProbe, discoveredMintUrls, loadMints, gateMode]);

  /**
   * Stops after the mint in flight finishes. Nothing is torn down mid-mint:
   * abandoning a keyset between `batchRestore` and `saveProofs` would leave the
   * derivation counter ahead of what was persisted, and the next run would
   * re-derive secrets the mint has already signed.
   */
  /**
   * Times each BDHKE primitive on its own, native vs JS. Separate from the
   * recovery run because it takes seconds of solid crypto — folding it into
   * every restore would tax the thing it is meant to measure.
   */
  const handleRunMicroBench = useCallback(async () => {
    if (recoveryInFlight || isBenchmarking) return;
    setIsBenchmarking(true);
    try {
      const rows = await runCryptoMicroBench();
      const compared = rows.filter((r) => r.cdkUs != null).length;
      staticPopup('crypto-benchmark-complete', {
        text: `${rows.length} operations timed, ${compared} with a native counterpart.`,
      });
    } finally {
      setIsBenchmarking(false);
    }
  }, [isBenchmarking]);

  const handleCancelRecovery = useCallback(() => {
    recoveryCancelled = true;
    setFinalizingLabel('Stopping after this mint');
    cashuLog.info('recovery.cancel.requested', {});
  }, []);

  const handleClose = useCallback(() => router.back(), []);

  // ─── Mint preview list (shared by idle + complete) ───────────────────────

  const renderMintList = () => (
    <Card variant="secondary" className="w-full">
      <Card.Body>
        <VStack gap={12}>
          {mints.map((mint) => {
            const displayName = getMintDisplayName(mint, mint.mintUrl);
            return (
              <HStack key={mint.mintUrl} gap={12} className="items-center">
                <MintIcon iconUrl={mint.mintInfo?.icon_url} name={displayName} size={36} />
                <Text size={14} bold numberOfLines={1} style={{ color: foreground, flex: 1 }}>
                  {displayName}
                </Text>
              </HStack>
            );
          })}
        </VStack>
      </Card.Body>
    </Card>
  );

  // ─── Idle state ─────────────────────────────────────────────────────────

  const renderIdleState = () => (
    <VStack gap={24} className="flex-1 px-6 pt-12">
      <VStack gap={24} className="flex-1 items-center justify-center">
        <View
          className="h-24 w-24 items-center justify-center self-center rounded-full"
          style={{ backgroundColor: surfaceSecondary }}>
          <Icon name="mdi:shield" size={48} color={foreground} />
        </View>

        <VStack gap={8} className="items-center">
          <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
            Recover Wallet
          </Text>
          <Text
            size={16}
            style={{ color: withAlpha(foreground, 0.5), textAlign: 'center', lineHeight: 24 }}>
            Recover ecash from your mints using your seed phrase.
          </Text>
        </VStack>

        {mints.length > 0 && renderMintList()}
      </VStack>

      <VStack gap={12} className="w-full items-center pb-6">
        <HStack
          className="w-full items-center justify-between rounded-2xl px-4 py-3"
          style={{ backgroundColor: surfaceSecondary }}>
          <VStack gap={2} style={{ flex: 1 }}>
            <Text size={14} bold style={{ color: foreground }}>
              Search all mints
            </Text>
            <Text size={12} style={{ color: withAlpha(foreground, 0.4) }}>
              {isDiscovering
                ? 'Loading mint list…'
                : deepProbe && discoveredMintUrls.length > 0
                  ? `${discoveredMintUrls.length} extra mints to check`
                  : 'Probe mints you may have used before'}
            </Text>
          </VStack>
          {isDiscovering ? (
            <View style={{ width: 24, alignItems: 'center' }}>
              <LoadingIndicator size={20} phase="loading" color={foreground} />
            </View>
          ) : (
            <Switch isSelected={deepProbe} onSelectedChange={setDeepProbe} />
          )}
        </HStack>

        {/* Benchmark A/B. Only offered once the self-test has proven the two
            implementations byte-identical, so flipping it changes speed and
            nothing else. */}
        {nativeAvailable && (
          <HStack
            className="w-full items-center justify-between rounded-2xl px-4 py-3"
            style={{ backgroundColor: surfaceSecondary }}>
            <VStack gap={2} style={{ flex: 1 }}>
              <Text size={14} bold style={{ color: foreground }}>
                Native crypto
              </Text>
              <Text size={12} style={{ color: withAlpha(foreground, 0.4) }}>
                {useNativeCrypto ? 'Rust CDK bindings' : 'cashu-ts fallback (slower)'}
              </Text>
            </VStack>
            <Switch isSelected={useNativeCrypto} onSelectedChange={setUseNativeCrypto} />
          </HStack>
        )}

        <Button
          variant="secondary"
          className="w-full"
          isDisabled={isBenchmarking}
          onPress={handleRunMicroBench}>
          <Button.Label>
            {isBenchmarking ? 'Benchmarking…' : 'Benchmark crypto operations'}
          </Button.Label>
        </Button>
        <SlideToConfirm
          onConfirm={handleStartRecovery}
          iconName="mdi:shield-refresh"
          label="Swipe to recover"
          trackColor={surfaceSecondary}
          thumbColor={foreground}
          textColor={foreground}
          iconColor={surfaceSecondary}
        />
        {!gateMode && (
          <Button variant="secondary" className="w-full" onPress={handleClose}>
            <Button.Label>Cancel</Button.Label>
          </Button>
        )}
      </VStack>
    </VStack>
  );

  // Every row in `results` is a mint we are actually restoring: probed mints
  // were already filtered down to those the shallow probe found history at, so
  // there is nothing left to hide and no separate aggregate probe row to show.
  const mintsByUrl = Object.fromEntries(mints.map((m) => [m.mintUrl, m]));
  const visibleResults = results;

  // ─── Recovering + complete states (single tree) ──────────────────────────
  //
  // Rendered with one JSX structure so React reconciles instead of
  // unmount/remount on the `recovering → complete` flip. That keeps the
  // hero LoadingIndicator and per-row indicators mounted across the
  // transition so they animate from `loading → done/success` instead of
  // mounting fresh in the terminal state and short-circuiting the
  // animation (see LoadingIndicator's `startedDone` ref).

  const renderActiveOrCompleteState = () => {
    const isComplete = phase === 'complete';
    // Every mint in the list is one we are really restoring, so the ring can
    // count them all — the denominator is fixed before the first mint starts
    // and never moves, which is what keeps the ring honest.
    const counts = computeRecoveryCounts(results);
    const successMintCount = visibleResults.filter((r) => isSuccess(r.status)).length;
    const active = currentMint(results);
    const activeMint = active ? mintsByUrl[active.mint] : undefined;
    return (
      <VStack gap={24} className="flex-1 px-6 pt-12">
        <VStack gap={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <LoadingIndicator
              size={48}
              phase={isComplete ? 'done' : 'loading'}
              result={counts.failed > 0 ? 'warning' : 'success'}
              // One segment per mint: the ring itself now carries how far the
              // run has actually got, instead of spinning identically from the
              // first mint to the last.
              segmentedProgress={{
                completedSegments: counts.settled,
                segmentCount: Math.max(1, counts.total),
              }}
              segmentedInProgress={phase === 'restoring'}
              color={foreground}
              successColor={successColor}
              errorColor={dangerColor}
              warningColor={warningColor}
            />
          </View>

          <VStack gap={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              {isComplete
                ? 'Recovery Complete'
                : phase === 'finalizing'
                  ? 'Finishing Up'
                  : 'Recovering Wallet'}
            </Text>
            <Text
              size={isComplete ? 16 : 14}
              style={{
                color: withAlpha(foreground, 0.5),
                textAlign: 'center',
                lineHeight: isComplete ? 24 : undefined,
              }}>
              {isComplete
                ? `Successfully recovered from ${successMintCount} mint${
                    successMintCount !== 1 ? 's' : ''
                  }.`
                : phase === 'finalizing' || phase === 'discovering'
                  ? (finalizingLabel ?? 'Putting your wallet back together')
                  : `Mint ${currentMintPosition(results)} of ${counts.total}`}
            </Text>
            {/* Proof of life. The JS thread blocks for tens of seconds at a
                time during restore, so this is deliberately UI-thread driven —
                it keeps counting when nothing else on screen can move. */}
            {!isComplete && (
              <ElapsedSeconds
                running={ACTIVE_PHASES.has(phase)}
                size={13}
                color={withAlpha(foreground, 0.4)}
                testID="recovery-elapsed"
              />
            )}
            {/* Naming the mint in flight only became possible once mints run
                one at a time. */}
            {active && (
              <Text size={13} numberOfLines={1} style={{ color: withAlpha(foreground, 0.6) }}>
                {getMintDisplayName(activeMint, active.mint)}
              </Text>
            )}
          </VStack>

          <Card variant="secondary" className="w-full">
            <Card.Body>
              <VStack gap={12}>
                {visibleResults.map((r, i) => (
                  <MintRecoveryRow
                    key={r.mint}
                    mintUrl={r.mint}
                    mint={mintsByUrl[r.mint]}
                    state={r}
                    index={i}
                  />
                ))}
              </VStack>
            </Card.Body>
          </Card>
        </VStack>

        <VStack gap={12} className="w-full pb-6">
          {isComplete ? (
            <Button
              variant="primary"
              className="w-full"
              onPress={gateMode ? onComplete : handleClose}>
              <Button.Label>{gateMode ? 'Continue' : 'Close'}</Button.Label>
            </Button>
          ) : (
            // Cancelling is only coherent because mints run one at a time: it
            // stops before the next mint rather than tearing down work in
            // flight. None of cashu.me, macadamia or minibits offers this.
            //
            // Never in gateMode: there, cancelling would skip mints, still
            // reach the 'complete' state (skipped mints are not failures), and
            // let Continue mark the restore permanently done — stranding funds
            // on the mints that never ran.
            !gateMode && (
              <Button
                variant="secondary"
                className="w-full"
                isDisabled={recoveryCancelled}
                onPress={handleCancelRecovery}>
                <Button.Label>{recoveryCancelled ? 'Stopping…' : 'Cancel'}</Button.Label>
              </Button>
            )
          )}
        </VStack>
      </VStack>
    );
  };

  // ─── Error state (retry available) ──────────────────────────────────────

  const renderErrorState = () => {
    const visibleSuccessCount = visibleResults.filter((r) => r.status === 'done').length;
    const visibleFailureCount = visibleResults.filter((r) => r.status !== 'done').length;

    return (
      <VStack gap={24} className="flex-1 px-6 pt-12">
        <VStack gap={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <LoadingIndicator
              size={48}
              phase="done"
              result="error"
              color={foreground}
              successColor={successColor}
              errorColor={dangerColor}
            />
          </View>

          <VStack gap={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              {visibleSuccessCount > 0 ? 'Recovery Partial' : 'Recovery Failed'}
            </Text>
            <Text
              size={16}
              style={{ color: withAlpha(foreground, 0.5), textAlign: 'center', lineHeight: 24 }}>
              {visibleSuccessCount > 0
                ? `Recovered from ${visibleSuccessCount} mint${visibleSuccessCount !== 1 ? 's' : ''}, but ${visibleFailureCount} failed.`
                : errorMessage || 'An unexpected error occurred during recovery.'}
            </Text>
          </VStack>

          {visibleResults.length > 0 && (
            <Card variant="secondary" className="w-full">
              <Card.Body>
                <VStack gap={12}>
                  {visibleResults.map((result) => {
                    const mint = mintsByUrl[result.mint];
                    const displayName = getMintDisplayName(mint, result.mint);
                    return (
                      <HStack key={result.mint} gap={12} className="items-center">
                        <MintIcon iconUrl={mint?.mintInfo?.icon_url} name={displayName} size={36} />
                        <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
                          <Text size={14} bold numberOfLines={1} style={{ color: foreground }}>
                            {displayName}
                          </Text>
                          {result.error && (
                            <Text size={12} numberOfLines={1} style={{ color: dangerColor }}>
                              {result.error}
                            </Text>
                          )}
                        </VStack>
                        <View style={{ width: DOT_SIZE, flexShrink: 0, alignItems: 'center' }}>
                          <LoadingIndicator
                            size={DOT_SIZE}
                            strokeWidthPx={STROKE_PX}
                            pendingColor={mutedColor}
                            successColor={successColor}
                            errorColor={dangerColor}
                            revertedColor={warningColor}
                            warningColor={warningColor}
                            {...mapCheckpointStatusToIndicator(
                              mintStatusToCheckpoint(result.status)
                            )}
                          />
                        </View>
                      </HStack>
                    );
                  })}
                </VStack>
              </Card.Body>
            </Card>
          )}
        </VStack>

        <VStack gap={12} className="w-full items-center pb-6">
          <SlideToConfirm
            onConfirm={handleStartRecovery}
            iconName="mdi:shield-refresh"
            label="Reswipe to try again"
            trackColor={surfaceSecondary}
            thumbColor={foreground}
            textColor={foreground}
            iconColor={surfaceSecondary}
          />
          {!gateMode && (
            <Button variant="secondary" className="w-full" onPress={handleClose}>
              <Button.Label>Close</Button.Label>
            </Button>
          )}
        </VStack>
      </VStack>
    );
  };

  return (
    <ScreenWrapper name="SettingsRecoveryScreen" scroll="custom" safeArea>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow"
        // Scrolling stays enabled throughout. Locking it during a run was
        // conflating "don't navigate away" with "don't move" — navigation is
        // already blocked by the beforeRemove guard above, and with a mint list
        // that can be taller than the screen, freezing the scroll just makes a
        // multi-minute operation feel like a hang.
        scrollEnabled>
        {(phase === 'idle' || phase === 'discovering') && renderIdleState()}
        {(phase === 'restoring' || phase === 'finalizing' || phase === 'complete') &&
          renderActiveOrCompleteState()}
        {phase === 'error' && renderErrorState()}
      </ScrollView>
    </ScreenWrapper>
  );
};

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getMintDisplayName(mint: Mint | undefined, fallbackUrl: string): string {
  return mint?.mintInfo?.name || tryHostname(fallbackUrl);
}

const MintRecoveryRow: React.FC<{
  mintUrl: string;
  mint?: Mint;
  state: MintRecoveryState;
  index: number;
}> = ({ mintUrl, mint, state, index }) => {
  const [foreground, mutedColor, successColor, dangerColor, warningColor] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
    'warning',
  ] as const);
  const { balances: liveBalances } = useBalanceContext();
  const mintBalance = liveBalances.byMint[mintUrl]?.total || 0;

  const displayName = getMintDisplayName(mint, mintUrl);
  // Derived at render rather than on a timer: renders arrive in bursts while
  // the JS thread is blocked, and a timer would be starved anyway.
  const progressLabel = describeMintProgress(state, Date.now());

  return (
    <HStack gap={12} className="items-center">
      <MintIcon iconUrl={mint?.mintInfo?.icon_url} name={displayName} size={36} />
      <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text size={14} bold numberOfLines={1} style={{ color: foreground }}>
          {displayName}
        </Text>
        <Text
          size={12}
          numberOfLines={1}
          style={{ color: state.status === 'failed' ? dangerColor : withAlpha(foreground, 0.4) }}>
          {progressLabel ?? `${mintBalance.toLocaleString()} sats`}
        </Text>
      </VStack>
      {/* Same dot the payment timeline draws, same size, stroke weight and
          cascade — minus the connector rail, since these rows are a list of
          independent mints rather than one payment's ordered steps. A queued
          mint resolves to phase `idle`: dimmed, dashed, and stationary. */}
      <View style={{ width: DOT_SIZE, flexShrink: 0, alignItems: 'center' }}>
        <LoadingIndicator
          size={DOT_SIZE}
          strokeWidthPx={STROKE_PX}
          transitionDelayMs={rowDelays(index).dotDelayMs}
          pendingColor={mutedColor}
          successColor={successColor}
          errorColor={dangerColor}
          revertedColor={warningColor}
          warningColor={warningColor}
          {...mapCheckpointStatusToIndicator(mintStatusToCheckpoint(state.status))}
        />
      </View>
    </HStack>
  );
};
