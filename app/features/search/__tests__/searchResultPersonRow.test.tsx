/**
 * A person in Search results is one tap target: it opens their profile, where
 * Send Money lives. The row carries no Pay button of its own.
 */
import type React from 'react';
import { render } from '@testing-library/react-native';

import type { SearchListItem } from '@/features/search/lib/searchSections';
import { SearchResultRows } from '@/shared/ui/composed/search/SearchResultRows';

const mockRowProps: Record<string, unknown>[] = [];
const mockButtons: Record<string, unknown>[] = [];
const mockNavigateToProfile = jest.fn();
const mockStartContactSend = jest.fn();

jest.mock('wallet/react', () => ({ usePaymentFlowMachine: () => ({}) }), { virtual: true });
jest.mock('@/runtime/WalletProjection', () => ({ useWalletContext: () => ({}) }));
jest.mock('@/features/send/components/DetectedActionRow', () => ({
  DetectedActionRow: () => null,
}));
jest.mock('@/features/send/lib/startContactSend', () => ({
  startContactSend: (...args: unknown[]) => mockStartContactSend(...args),
}));
jest.mock('@/features/search/lib/navigateToProfile', () => ({
  navigateToProfile: (pubkey: string) => mockNavigateToProfile(pubkey),
}));
jest.mock('@/features/payments/components/NoResultsFound', () => ({ NoResultsFound: () => null }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: {} }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'black' }));
jest.mock('@/shared/lib/logger', () => {
  const silent: object = new Proxy(() => undefined, { get: () => silent });
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : silent) });
});
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: (props: Record<string, unknown>) => {
    mockRowProps.push(props);
    return null;
  },
  geohashIdentity: () => ({}),
  mintIdentity: () => ({}),
  nostrIdentity: () => ({}),
}));
jest.mock('@/shared/ui/composed/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/shared/ui/composed/FollowBadge', () => ({ FollowBadge: () => null }));
jest.mock('@/shared/ui/composed/List', () => ({
  List: ({
    data,
    renderItem,
  }: {
    data: SearchListItem[];
    renderItem: (info: { item: SearchListItem }) => React.ReactNode;
    // One row is all this file renders.
  }) => (data[0] ? renderItem({ item: data[0] }) : null),
}));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: Record<string, unknown>) => {
    mockButtons.push(props);
    return null;
  },
}));

const BOB = 'b4'.repeat(32);
const person: SearchListItem = {
  type: 'person',
  id: `person:${BOB}`,
  pubkey: BOB,
  source: 'search',
  profile: { displayName: 'Bob', lud16: 'bob@example.com' },
  isLoadingProfile: false,
};

it('opens the profile on tap and has no Pay button', () => {
  render(
    <SearchResultRows items={[person]} status="ready" searchQuery="bob" remoteQueryLength={3} />
  );

  const row = mockRowProps.find((props) => props.testID === `contact-row:nostr:${BOB}`);
  expect(row).toBeDefined();
  expect(row?.trailing).toBeUndefined();
  expect(mockButtons).toEqual([]);

  (row?.onPress as () => void)();
  expect(mockNavigateToProfile).toHaveBeenCalledWith(BOB);
  expect(mockStartContactSend).not.toHaveBeenCalled();
});
