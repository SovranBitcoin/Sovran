jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  configureEnabledPaymentMethods: jest.fn(),
}));

import { drawerMenuItems } from '@/navigation/drawerMenu';
import { resolveFeatureSet, type Edition } from '@/shared/config/features';

const rows = (edition: Edition) => {
  const set = resolveFeatureSet(edition);
  return drawerMenuItems((feature) => set[feature]).map((item) => item.id);
};

describe('drawer menu', () => {
  it('lists every row in the full edition', () => {
    expect(rows('full')).toEqual([
      'feed',
      'wallet',
      'contacts',
      'notifications',
      'ai',
      'remote-login',
      'settings',
    ]);
  });

  it('drops only the AI row in payments', () => {
    expect(rows('payments')).toEqual([
      'feed',
      'wallet',
      'contacts',
      'notifications',
      'remote-login',
      'settings',
    ]);
  });

  it('keeps only rows with a destination when nostr is off', () => {
    expect(rows('lightningOnly')).toEqual(['wallet', 'settings']);
  });

  it('never lists a row whose tab the build does not ship', () => {
    const set = resolveFeatureSet('payments');
    for (const item of drawerMenuItems((feature) => set[feature])) {
      expect(item.route).not.toMatch(/\/ai$/);
    }
  });
});
