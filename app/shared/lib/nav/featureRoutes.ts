import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { hasFeature, type Feature } from '@/shared/config/features';
import { log } from '@/shared/lib/logger';

const navLog = log.child({ module: 'nav' });

/**
 * The module each entry screen belongs to, keyed by its leaf route name
 * (ADR 0021). Transaction history is exempt: a past payment stays viewable
 * after its rail is switched off. `(filter-flow)` is absent on purpose: it
 * holds the transaction filters, which every build ships.
 */
const ROUTE_FEATURE: Readonly<Record<string, Feature>> = {
  lightningSend: 'lightning',
  lightningReceive: 'lightning',
  onchainSend: 'onchain',
  onchainReceive: 'onchain',
  sendToken: 'ecash',
  receiveToken: 'ecash',
  paymentRequest: 'paymentRequests',
  nearPay: 'nutDrop',
  nearPayPeers: 'nutDrop',
  bitchatDM: 'nutDrop',
  bitchatNetwork: 'nutDrop',
  geohashChat: 'nutDrop',
  userMessages: 'directMessages',
  whitenoiseDM: 'directMessages',
  profile: 'nostr',
  claimUsername: 'nostr',
  composer: 'feed',
  thread: 'feed',
  stories: 'feed',
  provider: 'ai',
  providers: 'ai',
  aiRequest: 'ai',
};

/** Whole route groups that belong to one module. */
const GROUP_FEATURE: Readonly<Record<string, Feature>> = {
  '(signer-flow)': 'nostr',
  '(ai-flow)': 'ai',
  '(stories-flow)': 'feed',
};

/** Tabs that belong to one module; their nested screens go with them. */
const TAB_FEATURE: Readonly<Record<string, Feature>> = {
  feed: 'feed',
  notifications: 'feed',
  ai: 'ai',
  contacts: 'contacts',
};

const EXEMPT_GROUPS = new Set(['(transactions-flow)', '(settings-flow)']);

/** The disabled module a route needs, or null when the build ships it. */
export function disabledFeatureForRoute(
  segments: readonly string[],
  enabled: (feature: Feature) => boolean = hasFeature
): Feature | null {
  if (segments.some((segment) => EXEMPT_GROUPS.has(segment))) return null;
  const group = segments.find((segment) => segment in GROUP_FEATURE);
  const tabsAt = segments.indexOf('(tabs)');
  const tab = tabsAt === -1 ? undefined : segments[tabsAt + 1];
  const leaf = segments.at(-1);
  const feature = group
    ? GROUP_FEATURE[group]
    : tab && tab in TAB_FEATURE
      ? TAB_FEATURE[tab]
      : leaf
        ? ROUTE_FEATURE[leaf]
        : undefined;
  return feature && !enabled(feature) ? feature : null;
}

/** Send any navigation into a disabled module back to the wallet. */
export function useFeatureRouteGuard(): void {
  const segments = useSegments();
  const blocked = disabledFeatureForRoute(segments);
  useEffect(() => {
    if (!blocked) return;
    navLog.warn('nav.feature_route.blocked', { feature: blocked, route: segments.join('/') });
    router.replace('/');
  }, [blocked, segments]);
}
