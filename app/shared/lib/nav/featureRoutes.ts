import { useEffect } from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { hasFeature, type Feature } from '@/shared/config/features';
import { log } from '@/shared/lib/logger';

const navLog = log.child({ module: 'nav' });

/**
 * The module each entry screen belongs to, keyed by its leaf route name
 * (ADR 0021). Transaction history is exempt: a past payment stays viewable
 * after its rail is switched off (`HISTORY_ENTRY_PARAM`). `filters` is absent
 * on purpose: every build ships the transaction filters. So do the three tabs
 * (Wallet, Settings, Search) and the `(settings-flow)` pages.
 */
const ROUTE_FEATURE: Readonly<Record<string, Feature>> = {
  lightningSend: 'lightning',
  lightningReceive: 'lightning',
  onchainSend: 'onchain',
  onchainReceive: 'onchain',
  sendToken: 'ecash',
  receiveToken: 'ecash',
  messageEcash: 'ecashMessages',
  paymentRequest: 'paymentRequests',
  nearPay: 'nutDrop',
  nearPayPeers: 'nutDrop',
  bitchatDM: 'nutDrop',
  bitchatNetwork: 'nutDrop',
  geohashChat: 'nutDrop',
  profile: 'nostr',
  claimUsername: 'nostr',
};

const EXEMPT_GROUPS = new Set(['(settings-flow)']);

/**
 * The payment detail routes that transaction history opens, each with the
 * param that carries the history row it shows. `navigateToTransactionDetail`
 * marks such an entry `historyView=1` and passes the row; only an entry with
 * both is a past payment, readable after its rail is switched off. A bare
 * `historyView=1` cannot open a disabled rail's live flow.
 */
const HISTORY_ENTRY_PARAM: Readonly<Record<string, string>> = {
  lightningSend: 'meltHistoryEntry',
  onchainSend: 'meltHistoryEntry',
  lightningReceive: 'mintHistoryEntry',
  onchainReceive: 'mintHistoryEntry',
  sendToken: 'sendHistoryEntry',
  receiveToken: 'receiveHistoryEntry',
};

type RouteParams = Readonly<Record<string, string | string[] | undefined>>;

function isHistoryEntry(leaf: string, params: RouteParams): boolean {
  const entryParam = HISTORY_ENTRY_PARAM[leaf];
  if (!entryParam || params.historyView !== '1') return false;
  const entry = params[entryParam];
  return typeof entry === 'string' && entry.length > 0;
}

/** The disabled module a route needs, or null when the build ships it. */
export function disabledFeatureForRoute(
  segments: readonly string[],
  enabled: (feature: Feature) => boolean = hasFeature,
  params: RouteParams = {}
): Feature | null {
  if (segments.some((segment) => EXEMPT_GROUPS.has(segment))) return null;
  const leaf = segments.at(-1);
  if (!leaf || isHistoryEntry(leaf, params)) return null;
  const feature = ROUTE_FEATURE[leaf];
  return feature && !enabled(feature) ? feature : null;
}

/** Send any navigation into a disabled module back to the wallet. */
export function useFeatureRouteGuard(): void {
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const blocked = disabledFeatureForRoute(segments, hasFeature, params);
  useEffect(() => {
    if (!blocked) return;
    navLog.warn('nav.feature_route.blocked', { feature: blocked, route: segments.join('/') });
    router.replace('/');
  }, [blocked, segments]);
}
