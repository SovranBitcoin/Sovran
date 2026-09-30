// ---------------------------------------------------------------------------
// Feature set — which parts of Sovran this build ships (ADR 0021).
//
// One build-time answer to "is X in this wallet?". Surfaces filter their
// option lists through `hasFeature`; the wallet package receives the rails
// through `configureEnabledPaymentMethods` at startup. Nothing here is
// persisted, so an edition change never touches user data.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { configureEnabledPaymentMethods, type MintPaymentMethod } from 'wallet';

/** Every switchable module. Dependencies are declared in `REQUIRES`. */
export const FEATURES = [
  // Payment rails
  'ecash', // bearer tokens: create, paste, scan, Cashu receive tab
  'lightning', // bolt11 + LNURL / lightning address
  'bolt12', // reusable offers
  'onchain', // on-chain deposits and withdrawals via the mint
  'paymentRequests', // NUT-18
  // Nostr
  'nostr', // identity, profiles; every other Nostr module needs it
  'nostrSearch', // people / npub search
  'ecashMessages', // send ecash to a contact over NIP-17 DMs
  'contacts', // Contacts tab
  'feed', // Feed + Notifications tabs, composer
  // Proximity
  'nfc', // tap to pay
  'nutDrop', // Bluetooth Nut Drop
  // Extras
  'ai', // Routstr AI tab
] as const;

export type Feature = (typeof FEATURES)[number];
export type FeatureSet = Readonly<Record<Feature, boolean>>;

/** A feature is only on when everything it needs is on. */
const REQUIRES: Partial<Record<Feature, readonly Feature[]>> = {
  bolt12: ['lightning'],
  paymentRequests: ['ecash'],
  nostrSearch: ['nostr'],
  ecashMessages: ['nostr', 'ecash'],
  contacts: ['nostr'],
  feed: ['nostr'],
  nfc: ['ecash'],
  nutDrop: ['ecash'],
  ai: ['ecash'],
};

const RAILS = ['ecash', 'lightning', 'onchain'] as const satisfies readonly Feature[];

const all = (on: boolean): Record<Feature, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f, on])) as Record<Feature, boolean>;

const only = (...enabled: Feature[]): FeatureSet => {
  const set = all(false);
  for (const f of enabled) set[f] = true;
  return set;
};

/** Named editions. Add one here to ship a new product shape. */
export const EDITIONS = {
  full: all(true),
  lightningOnly: only('lightning', 'bolt12'),
  onchainOnly: only('onchain'),
  ecashLightning: only('ecash', 'lightning', 'bolt12', 'paymentRequests', 'nfc', 'nutDrop'),
  /** Everything except the social layer: no search, feed or DMs. */
  private: {
    ...all(true),
    nostr: false,
    nostrSearch: false,
    ecashMessages: false,
    contacts: false,
    feed: false,
  },
} as const satisfies Record<string, FeatureSet>;

export type Edition = keyof typeof EDITIONS;

/**
 * Apply `overrides` to an edition, then switch off anything whose
 * requirements are missing (to a fixed point, so chains resolve).
 * Throws when no rail is left: a wallet that cannot move money is a
 * configuration error, not an edition.
 */
export function resolveFeatureSet(
  edition: Edition,
  overrides: Partial<Record<Feature, boolean>> = {}
): FeatureSet {
  const set: Record<Feature, boolean> = { ...EDITIONS[edition], ...overrides };
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FEATURES) {
      if (set[f] && REQUIRES[f]?.some((dep) => !set[dep])) {
        set[f] = false;
        changed = true;
      }
    }
  }
  if (!RAILS.some((rail) => set[rail])) {
    throw new Error(`Feature set for edition "${edition}" enables no payment rail`);
  }
  return Object.freeze(set);
}

const overridesSchema = z.partialRecord(z.enum(FEATURES), z.boolean());

/**
 * Read the build's feature set from `EXPO_PUBLIC_SOVRAN_EDITION` (an edition
 * name) and `EXPO_PUBLIC_SOVRAN_FEATURES` (JSON overrides, e.g.
 * `{"ecashMessages":false}`). Unknown values fail the build loudly rather
 * than silently shipping `full`.
 */
export function featureSetFromEnv(env: {
  edition?: string | undefined;
  features?: string | undefined;
}): FeatureSet {
  const edition = env.edition || 'full';
  if (!(edition in EDITIONS)) {
    throw new Error(`Unknown EXPO_PUBLIC_SOVRAN_EDITION "${edition}"`);
  }
  const overrides = env.features ? overridesSchema.parse(JSON.parse(env.features)) : {};
  return resolveFeatureSet(edition as Edition, overrides);
}

// Metro inlines EXPO_PUBLIC_* only for static `process.env.X` reads.
const featureSet = featureSetFromEnv({
  edition: process.env.EXPO_PUBLIC_SOVRAN_EDITION,
  features: process.env.EXPO_PUBLIC_SOVRAN_FEATURES,
});

export function hasFeature(feature: Feature): boolean {
  return featureSet[feature];
}

/** Hand the build's rails to the wallet package. Call once at startup. */
export function applyFeatureSetToWallet(set: FeatureSet = featureSet): void {
  const methods: MintPaymentMethod[] = [];
  if (set.lightning) methods.push('bolt11');
  if (set.bolt12) methods.push('bolt12');
  if (set.onchain) methods.push('onchain');
  configureEnabledPaymentMethods(methods);
}
