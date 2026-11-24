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
    expect(rows('full')).toEqual(['wallet', 'contacts', 'remote-login', 'settings']);
  });

  it('lists the same rows in payments', () => {
    expect(rows('payments')).toEqual(['wallet', 'contacts', 'remote-login', 'settings']);
  });

  it('keeps only rows with a destination when nostr is off', () => {
    expect(rows('lightningOnly')).toEqual(['wallet', 'settings']);
  });
});
