jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  configureEnabledPaymentMethods: jest.fn(),
}));

import { configureEnabledPaymentMethods } from 'wallet';
import {
  applyFeatureSetToWallet,
  EDITIONS,
  featureSetFromEnv,
  resolveFeatureSet,
} from '@/shared/config/features';
import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';
import { featureDetectors } from '@/shared/config/featureDetectors';
import { disabledFeatureForRoute } from '@/shared/lib/nav/featureRoutes';

describe('feature set', () => {
  it('ships everything by default', () => {
    expect(featureSetFromEnv({})).toEqual(EDITIONS.full);
  });

  it('drops dependants of a disabled module', () => {
    const set = resolveFeatureSet('full', { nostr: false });
    expect(set.nostrSearch).toBe(false);
    expect(set.ecashMessages).toBe(false);
    expect(set.feed).toBe(false);
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
    expect(disabledFeatureForRoute(['(user-flow)', 'userMessages'], enabled)).toBe('nostr');
    expect(disabledFeatureForRoute(['(send-flow)', 'lightningSend'], enabled)).toBeNull();
  });

  it('blocks whole groups owned by a module', () => {
    expect(disabledFeatureForRoute(['(ai-flow)', 'providers'], enabled)).toBe('ai');
    expect(disabledFeatureForRoute(['(signer-flow)', 'index'], enabled)).toBe('nostr');
  });

  it('keeps history viewable', () => {
    expect(disabledFeatureForRoute(['(transactions-flow)', 'sendToken'], enabled)).toBeNull();
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
