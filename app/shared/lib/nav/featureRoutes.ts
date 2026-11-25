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

interface HistoryEntryRule {
  readonly param: string;
  readonly type: 'mint' | 'melt' | 'send' | 'receive';
  readonly requiresQuoteId: boolean;
}

/**
 * The payment detail routes that transaction history opens, each with the
 * param and persisted-entry shape it expects. `navigateToTransactionDetail`
 * marks such an entry `historyView=1` and passes the serialized Coco history
 * row; only a well-formed persisted entry is readable after its rail is
 * switched off. A bare `historyView=1`, an empty `{}` payload, or a synthetic
 * preview (`quoteId: ''`) cannot open a disabled rail's live flow.
 */
const HISTORY_ENTRY_RULE: Readonly<Record<string, HistoryEntryRule>> = {
  lightningSend: { param: 'meltHistoryEntry', type: 'melt', requiresQuoteId: true },
  onchainSend: { param: 'meltHistoryEntry', type: 'melt', requiresQuoteId: true },
  lightningReceive: { param: 'mintHistoryEntry', type: 'mint', requiresQuoteId: true },
  onchainReceive: { param: 'mintHistoryEntry', type: 'mint', requiresQuoteId: true },
  sendToken: { param: 'sendHistoryEntry', type: 'send', requiresQuoteId: false },
  receiveToken: { param: 'receiveHistoryEntry', type: 'receive', requiresQuoteId: false },
};

type RouteParams = Readonly<Record<string, string | string[] | undefined>>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasNonEmptyId(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' && Number.isFinite(value);
}

function isHistoryEntry(leaf: string, params: RouteParams): boolean {
  const rule = HISTORY_ENTRY_RULE[leaf];
  if (!rule || params.historyView !== '1') return false;
  const raw = params[rule.param];
  if (typeof raw !== 'string' || raw.length === 0) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  if (record.type !== rule.type) return false;
  if (!hasNonEmptyId(record.id)) return false;
  if (!isNonEmptyString(record.mintUrl)) return false;
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return false;
  if (rule.requiresQuoteId && !isNonEmptyString(record.quoteId)) return false;
  return true;
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
