/** Plain-English display labels for the machine facet vocabulary
 * (schema/facets.ts) and for platforms. The JSON keeps the stable
 * `facet:value` ids; only the viewer renders these labels. A completeness
 * test pins this map to FACETS so new vocabulary cannot ship unlabeled. */

import type { Platform } from '../../schema/capabilities';
import { FACETS, type FacetName } from '../../schema/facets';

export const PLATFORM_LABELS: Record<Platform, string> = {
  ios: 'iPhone',
  android: 'Android',
};

export const FLOW_GROUP_LABELS: Record<(typeof FACETS)['flow'][number], string> = {
  onboarding: 'Getting started',
  recovery: 'Wallet recovery',
  receive: 'Receiving money',
  send: 'Sending money',
  history: 'Transaction history',
  isolation: 'Profile isolation',
  mint: 'Mints',
  wallet: 'Wallet & app',
};

export const FACET_VALUE_LABELS: Record<FacetName, Record<string, string>> = {
  flow: FLOW_GROUP_LABELS,
  instrument: {
    bolt11: 'Lightning invoice',
    'cashu-token': 'ecash token',
    'payment-request': 'payment request',
    npc: 'ecash address',
  },
  amount: {
    fixed: 'typed amount',
    any: 'any amount',
  },
  io: {
    paste: 'pasted in',
    copy: 'copied out',
    scan: 'QR scanned',
    display: 'shown as QR',
    deeplink: 'opened via link',
  },
  outcome: {
    settled: 'payment completed',
    dismissed: 'cancelled by user',
    'rolled-back': 'money returned after failure',
    reclaimed: 'money taken back',
  },
  check: {
    'mint-change': 'switching mints',
    'mint-add': 'adding a mint',
    toast: 'pop-up notice',
    'tx-source': 'transaction source label',
    'share-actions': 'share buttons',
    'context-isolation': 'no leftover state between flows',
    rebalance: 'moving money between mints',
    'zero-balance': 'empty wallet handled',
    'mint-preselect': 'mint chosen in advance',
    'fiat-unit': 'dollar-amount display',
    search: 'search',
    offline: 'works offline',
    dm: 'direct messages',
    navigation: 'moving between screens',
    'p2pk-keys': 'payments locked to a key',
    filters: 'list filters',
    'mint-fault': 'mint misbehaving',
    permission: 'device permission denied',
    'invalid-input': 'garbage input handled safely',
    'empty-state': 'helpful empty screen',
    interruption: 'interrupted mid-payment',
    persistence: 'survives an app restart',
    'fault-tbd': 'documents current behavior',
    'fault-fake-double-spend': 'faked double-spend reply',
  },
};

/** Human label for a `facet:value` tag; falls back to the raw tag for
 * historical bare/unknown tags so old run artifacts still render. */
export function facetTagLabel(tag: string): string {
  const colon = tag.indexOf(':');
  if (colon < 0) return tag;
  const name = tag.slice(0, colon) as FacetName;
  const value = tag.slice(colon + 1);
  return FACET_VALUE_LABELS[name]?.[value] ?? tag;
}

/** Left-panel group header label for a flow facet (or the untagged bucket). */
export function flowGroupLabel(flow: string): string {
  if (flow === 'untagged') return 'Untagged';
  return FLOW_GROUP_LABELS[flow as keyof typeof FLOW_GROUP_LABELS] ?? flow;
}

/** Compact platform chips ("iPhone", "Android") for a derived platform list. */
export function platformLabels(platforms: readonly Platform[]): string[] {
  return platforms.map((platform) => PLATFORM_LABELS[platform]);
}
