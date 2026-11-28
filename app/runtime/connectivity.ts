/**
 * Whether the phone can reach the internet, owned by the app runtime.
 *
 * One connectivity engine runs while the app root is mounted
 * (`startConnectivity`); its verdict lives here, outside React, so the
 * payment machine, the price feed and every screen read the same answer.
 * Going offline must be confirmed; coming back online is instant.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { log } from '@/shared/lib/logger';
import {
  resolveOfflineReachability,
  type OfflineReachabilityResult,
} from '@/shared/lib/offlineReachability';

type OfflineStatus = {
  /** Confirmed offline: no network, or no reachability target answered. */
  isOffline: boolean;
  /**
   * Confirmed offline because the phone itself reports no network, not merely
   * because the probes failed. Work with its own fallbacks (BTC prices fall
   * back from Coinbase to Mempool.space) pauses only on this.
   */
  isDisconnected: boolean;
};

type NetworkVerdict = { offline: boolean; disconnected: boolean };

const ONLINE: NetworkVerdict = { offline: false, disconnected: false };
let network: NetworkVerdict = ONLINE;
const listeners = new Set<() => void>();

function setNetwork(next: NetworkVerdict): void {
  if (next.offline === network.offline && next.disconnected === network.disconnected) return;
  network = next;
  listeners.forEach((listener) => listener());
}

// While online, the OS network listener and the return to the foreground do
// the work; the poll only catches a connection that dies without either (a
// captive portal, a dead uplink), so it runs every 5 min instead of every
// minute. Each check fires up to five HTTPS probes, and a burst a minute kept
// the cellular radio from idling. The send flow asks for a check of its own
// (`recheckConnectivity`), so offline send never waits for the poll.
const CONNECTIVITY_POLL_MS = 5 * 60_000;
/** The offline retry back-off still tops out at a minute. */
const OFFLINE_RETRY_MAX_MS = 60_000;
const OFFLINE_RETRY_MS = 3000;
// Offline hysteresis: going offline must be CONFIRMED (consecutive failed
// evaluations spanning a minimum window) while coming back online is instant.
// Android's network listener fires per transport change (Wi-Fi<->cell, VPN,
// Doze) with transiently-false reachability fields, which used to flap the
// banner several times a minute while genuinely online.
const OFFLINE_CONFIRM_CHECKS = 2;
const OFFLINE_CONFIRM_MS = 5000;
const OFFLINE_RECHECK_DELAY_MS = 1200;
const MIN_EVAL_INTERVAL_MS = 750;

function summarizeReachability(result: OfflineReachabilityResult) {
  const successfulProbe = result.probes.find((probe) => probe.ok);
  const lastProbe = result.probes.at(-1);
  return {
    reachabilityReason: result.reason,
    probeStatus: result.probes.length === 0 ? 'skipped' : result.isOffline ? 'failed' : 'success',
    probeHost: successfulProbe?.host ?? lastProbe?.host,
    probeName: successfulProbe?.name ?? lastProbe?.name,
    probeStatusCode: successfulProbe?.status ?? lastProbe?.status,
    probeError: lastProbe?.ok ? undefined : lastProbe?.error,
    probeCount: result.probes.length,
    // The targets are asked at once, so the check took as long as the slowest.
    probeDurationMs: result.probes.reduce(
      (longest, probe) => Math.max(longest, probe.durationMs),
      0
    ),
    // Which target's answer made the verdict "online"; absent when offline.
    answeredBy: result.answeredBy,
    // Every target that had answered or failed by the verdict, e.g. "nagg:404,relay:200".
    probeOutcomes: result.probes
      .map((probe) => `${probe.name}:${probe.status ?? probe.error ?? 'failed'}`)
      .join(','),
  };
}

let recheck: (() => void) | null = null;

/**
 * Check reachability now instead of at the next poll, for a screen about to
 * decide between an online and an offline payment. A no-op in the background
 * or while the engine is stopped.
 */
export function recheckConnectivity(): void {
  recheck?.();
}

// The connectivity engine: polls and listens, applying the offline
// hysteresis above, and writes its verdict to the store. Returns its stop.
function startConnectivityEngine(): () => void {
  let mounted = true;
  let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
  let checking = false;
  let refreshOnResume = false;
  let interval: ReturnType<typeof setTimeout> | null = null;
  let offlineRounds = 0;
  let networkSubscription: { remove: () => void } | null = null;
  let lastOffline: boolean | null = null;
  let lastCheckId = 0;
  // Offline-confirmation (hysteresis) state — see constants above.
  let offlineSince: number | null = null;
  let offlineEvals = 0;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEvalAt = 0;

  const commit = (
    nowOffline: boolean,
    reachabilityLog: ReturnType<typeof summarizeReachability>,
    disconnected: boolean
  ) => {
    const prev = network.offline;
    if (prev !== nowOffline) {
      log.info('provider.offline.transition', {
        from: prev ? 'offline' : 'online',
        to: nowOffline ? 'offline' : 'online',
        ...reachabilityLog,
      });
    }
    setNetwork({ offline: nowOffline, disconnected });
  };

  const applyState = async (state: Network.NetworkState, checkId: number) => {
    try {
      const reachability = await resolveOfflineReachability(state);
      if (!mounted || !active || checkId !== lastCheckId) return;
      const nowOffline = reachability.isOffline;
      const reachabilityLog = summarizeReachability(reachability);
      // Only log when state actually changes to reduce noise.
      if (lastOffline !== nowOffline) {
        log.debug('provider.offline.network_state', {
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          type: state.type,
          resolvedOffline: nowOffline,
          ...reachabilityLog,
        });
        lastOffline = nowOffline;
      }
      if (!nowOffline) {
        offlineRounds = 0;
        if (offlineSince !== null) {
          log.debug('provider.offline.pending_cancelled', { evals: offlineEvals });
        }
        offlineSince = null;
        offlineEvals = 0;
        if (recheckTimer) {
          clearTimeout(recheckTimer);
          recheckTimer = null;
        }
        commit(false, reachabilityLog, false);
        return;
      }
      offlineEvals += 1;
      offlineSince ??= Date.now();
      const confirmed =
        offlineEvals >= OFFLINE_CONFIRM_CHECKS && Date.now() - offlineSince >= OFFLINE_CONFIRM_MS;
      if (confirmed) {
        offlineRounds += 1;
        if (recheckTimer) clearTimeout(recheckTimer);
        recheckTimer = null;
        commit(true, reachabilityLog, reachability.reason === 'network-disconnected');
        return;
      }
      log.debug('provider.offline.pending', {
        evals: offlineEvals,
        sinceMs: Date.now() - offlineSince,
        ...reachabilityLog,
      });
      recheckTimer ??= setTimeout(() => {
        recheckTimer = null;
        void runConnectivityCheck();
      }, OFFLINE_RECHECK_DELAY_MS);
    } catch (err) {
      log.warn('provider.offline.check_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  };

  const runConnectivityCheck = async () => {
    if (!mounted || !active || checking) return;
    // Coalesce listener bursts and overlapping poll/listener triggers — the
    // pending re-check (1200ms) and adaptive poll clear this naturally.
    if (Date.now() - lastEvalAt < MIN_EVAL_INTERVAL_MS) return;
    lastEvalAt = Date.now();
    checking = true;
    refreshOnResume = false;
    const checkId = ++lastCheckId;
    try {
      const state = await Network.getNetworkStateAsync();
      if (!mounted || !active || checkId !== lastCheckId) return;
      await applyState(state, checkId);
    } catch (err) {
      log.warn('provider.offline.check_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      checking = false;
      if (mounted && active && refreshOnResume) {
        lastEvalAt = 0;
        void runConnectivityCheck();
      } else if (mounted && active) {
        if (interval) clearTimeout(interval);
        const delay =
          lastOffline === true
            ? Math.min(OFFLINE_RETRY_MAX_MS, OFFLINE_RETRY_MS * 2 ** Math.min(offlineRounds - 1, 5))
            : CONNECTIVITY_POLL_MS;
        interval = setTimeout(runConnectivityCheck, Math.max(OFFLINE_RETRY_MS, delay));
      }
    }
  };

  log.debug('provider.offline.init', { pollIntervalMs: CONNECTIVITY_POLL_MS });
  void runConnectivityCheck();
  // Route listener events through runConnectivityCheck (mutex + coalescing)
  // instead of applyState directly: getNetworkStateAsync re-reads fresh
  // state, and the native module already delays emissions for staleness.
  networkSubscription = Network.addNetworkStateListener(() => {
    void runConnectivityCheck();
  });

  const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
    const nextActive = nextAppState === 'active';
    if (active === nextActive) return;
    active = nextActive;
    ++lastCheckId;
    offlineSince = null;
    offlineEvals = 0;
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
    if (interval) clearTimeout(interval);
    interval = null;
    offlineRounds = 0;
    if (!active) return;
    log.debug('provider.offline.app_foregrounded', { reason: 'app_state_active' });
    // Revalidate after foreground even if an earlier probe is still settling.
    refreshOnResume = true;
    lastEvalAt = 0;
    void runConnectivityCheck();
  });

  recheck = () => {
    if (!mounted || !active) return;
    if (checking) {
      refreshOnResume = true;
      return;
    }
    lastEvalAt = 0;
    void runConnectivityCheck();
  };

  const onWebOnline = () => {
    log.info('provider.offline.web_event', { event: 'online' });
    void runConnectivityCheck();
  };

  const onWebOffline = () => {
    log.info('provider.offline.web_event', { event: 'offline' });
    setNetwork({ offline: true, disconnected: true });
  };

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('online', onWebOnline);
    window.addEventListener('offline', onWebOffline);
  }

  return () => {
    mounted = false;
    recheck = null;
    if (interval) {
      clearTimeout(interval);
    }
    networkSubscription?.remove();
    appStateSubscription.remove();
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.removeEventListener('online', onWebOnline);
      window.removeEventListener('offline', onWebOffline);
    }
  };
}

let engineUsers = 0;
let stopEngine: (() => void) | null = null;

/**
 * Starts the connectivity engine (once, however many callers) and returns the
 * stop. The verdict resets to online when the last caller stops.
 */
export function startConnectivity(): () => void {
  engineUsers += 1;
  if (engineUsers === 1) stopEngine = startConnectivityEngine();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    engineUsers -= 1;
    if (engineUsers > 0) return;
    stopEngine?.();
    stopEngine = null;
    setNetwork(ONLINE);
  };
}

function resolveStatus(verdict: NetworkVerdict, mockOffline: boolean): OfflineStatus {
  return {
    isOffline: mockOffline || verdict.offline,
    isDisconnected: mockOffline || (verdict.offline && verdict.disconnected),
  };
}

/** The current status, for code outside React. */
export function getOfflineStatus(): OfflineStatus {
  return resolveStatus(network, useSettingsStore.getState().mockOffline);
}

/** Calls `listener` whenever the network verdict or the mock-offline setting changes. */
export function subscribeOfflineStatus(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.mockOffline !== previous.mockOffline) listener();
  });
  return () => {
    listeners.delete(listener);
    unsubscribeSettings();
  };
}

function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getNetwork = () => network;

export function useOfflineStatus(): OfflineStatus {
  const verdict = useSyncExternalStore(subscribeNetwork, getNetwork, getNetwork);
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const { isOffline, isDisconnected } = resolveStatus(verdict, mockOffline);
  // Consumers destructure or depend on the whole object; keep its identity
  // tied to the two booleans.
  // ast-grep-ignore: no-manual-memo-tsx
  return useMemo(() => ({ isOffline, isDisconnected }), [isOffline, isDisconnected]);
}
