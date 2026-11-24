import { readFileSync } from 'node:fs';
import { join } from 'node:path';
jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  configureEnabledPaymentMethods: jest.fn(),
}));

import { configureEnabledPaymentMethods } from 'wallet';
import {
  applyFeatureSetToWallet,
  DEFAULT_EDITION,
  EDITIONS,
  FEATURES,
  featureSetFromEnv,
  resolveFeatureSet,
} from '@/shared/config/features';
import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';
import { featureDetectors } from '@/shared/config/featureDetectors';
import { disabledFeatureForRoute } from '@/shared/lib/nav/featureRoutes';
import { computeVisibleScopes } from '@/shared/ui/composed/search/scopes';

describe('feature set', () => {
  it('ships the payments edition by default', () => {
    expect(DEFAULT_EDITION).toBe('payments');
    expect(featureSetFromEnv({})).toEqual(EDITIONS.payments);
    expect(featureSetFromEnv({ edition: '' })).toEqual(EDITIONS.payments);
  });

  it('keeps the full edition selectable', () => {
    const set = featureSetFromEnv({ edition: 'full' });
    expect(FEATURES.every((feature) => set[feature])).toBe(true);
  });

  it('ships every module in payments', () => {
    const set = resolveFeatureSet('payments');
    expect(FEATURES.filter((feature) => !set[feature])).toEqual([]);
  });

  it('redeems message ecash at account scope, with no DM pages', () => {
    // No build ships conversation pages, so ecash sent as a message is only
    // claimed because a provider mounts with `ecashMessages`. If that mount is
    // ever gated on anything else, money could arrive that nobody claims.
    const layout = readFileSync(
      join(__dirname, '..', 'shared', 'providers', 'AccountProviders.tsx'),
      'utf8'
    );
    expect(layout).toContain("hasFeature('ecashMessages') ? [DmEcashAutoRedeemProvider] : []");
    expect(resolveFeatureSet('payments').ecashMessages).toBe(true);
  });

  it('drops dependants of a disabled module', () => {
    const set = resolveFeatureSet('full', { nostr: false });
    expect(set.nostrSearch).toBe(false);
    expect(set.ecashMessages).toBe(false);
    expect(set.ecash).toBe(true);
  });

  it('turns off ecash messages alone', () => {
    const set = featureSetFromEnv({ features: '{"ecashMessages":false}' });
    expect(set.ecashMessages).toBe(false);
    expect(set.nostrSearch).toBe(true);
  });

  it('rejects a set with no payment rail', () => {
    expect(() => resolveFeatureSet('onchainOnly', { onchain: false })).toThrow(/no payment rail/);
  });

  it('rejects unknown editions and features', () => {
    expect(() => featureSetFromEnv({ edition: 'nope' })).toThrow(/Unknown/);
    expect(() => featureSetFromEnv({ features: '{"teleport":true}' })).toThrow();
  });

  it('hands only enabled rails to the wallet', () => {
    applyFeatureSetToWallet(resolveFeatureSet('lightningOnly'));
    expect(configureEnabledPaymentMethods).toHaveBeenLastCalledWith(['bolt11', 'bolt12']);
  });

  it('shows the Unified receive tab only over two or more rails', () => {
    const on = (set: typeof EDITIONS.full) => (f: keyof typeof EDITIONS.full) => set[f];
    expect(computeReceiveTabs(on(EDITIONS.full))).toEqual([
      'Unified',
      'Lightning',
      'Onchain',
      'Cashu',
    ]);
    expect(computeReceiveTabs(on(resolveFeatureSet('lightningOnly')))).toEqual(['Lightning']);
    expect(computeReceiveTabs(on(resolveFeatureSet('ecashLightning')))).toEqual([
      'Unified',
      'Lightning',
      'Cashu',
    ]);
  });
});

describe('feature route guard', () => {
  const set = resolveFeatureSet('lightningOnly');
  const enabled = (f: keyof typeof set) => set[f];

  it('blocks entry screens of a disabled module', () => {
    expect(disabledFeatureForRoute(['(send-flow)', 'sendToken'], enabled)).toBe('ecash');
    expect(disabledFeatureForRoute(['(user-flow)', 'profile'], enabled)).toBe('nostr');
    expect(disabledFeatureForRoute(['(send-flow)', 'lightningSend'], enabled)).toBeNull();
  });

  it('keeps the wallet and profile routes open in payments', () => {
    const payments = resolveFeatureSet('payments');
    const on = (f: keyof typeof payments) => payments[f];
    expect(disabledFeatureForRoute(['(drawer)', '(tabs)', 'index'], on)).toBeNull();
    expect(disabledFeatureForRoute(['(user-flow)', 'profile'], on)).toBeNull();
  });

  it('keeps every tab open in every build, nostr or not', () => {
    for (const edition of ['private', 'lightningOnly', 'onchainOnly'] as const) {
      const set = resolveFeatureSet(edition);
      const on = (f: keyof typeof set) => set[f];
      for (const tab of ['index', 'settings', 'search']) {
        expect(disabledFeatureForRoute(['(drawer)', '(tabs)', tab], on)).toBeNull();
      }
    }
  });

  it('keeps history viewable', () => {
    expect(disabledFeatureForRoute(['(transactions-flow)', 'sendToken'], enabled)).toBeNull();
  });
});

describe('search scopes', () => {
  const counts = { people: 1, mints: 1, groups: 1 };

  it('offers People only with people search', () => {
    const full = resolveFeatureSet('full');
    const noNostr = resolveFeatureSet('full', { nostr: false });
    expect(computeVisibleScopes('', counts, (f) => full[f])).toEqual([
      'All',
      'People',
      'Mints',
      'Groups',
    ]);
    expect(computeVisibleScopes('lon', counts, (f) => noNostr[f])).toEqual([
      'All',
      'Mints',
      'Groups',
    ]);
  });
});

describe('feature detectors', () => {
  it('blinds detectors of disabled modules', () => {
    const set = resolveFeatureSet('lightningOnly');
    const detectors = featureDetectors((f) => set[f]);
    expect(detectors.isValidEcashToken('cashuB...')).toBe(false);
    expect(detectors.parseNpub('npub1...')).toBeNull();
    expect(detectors.isLightningAddress('alice@example.com')).toBe(true);
  });
});
