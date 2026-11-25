/**
 * The Settings Moderation page is gone, but an upgrading account may still
 * have its DM word filter on. The DM screen itself says so and turns it off
 * in place; the saved words stay as they were.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { DmWordFilterStrip } from '@/features/bitchat/components/DmWordFilterStrip';
import { useFeedIgnoreStore } from '@/shared/stores/profile/ignoreStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/features/bitchat/components/BluetoothNotice', () => ({
  ChatStatusStrip: (props: { action?: unknown }) => props.action,
}));

it('shows nothing while the filter is off or has no words', () => {
  useFeedIgnoreStore.setState({ dmFilterEnabled: false, dmFilterWords: ['bad'] });
  render(<DmWordFilterStrip />);
  expect(screen.queryByTestId('dm-word-filter-off')).toBeNull();
  screen.unmount();
  useFeedIgnoreStore.setState({ dmFilterEnabled: true, dmFilterWords: [] });
  render(<DmWordFilterStrip />);
  expect(screen.queryByTestId('dm-word-filter-off')).toBeNull();
});

it('turns an inherited filter off from the DM screen, keeping the words', () => {
  useFeedIgnoreStore.setState({ dmFilterEnabled: true, dmFilterWords: ['bad'] });
  render(<DmWordFilterStrip />);
  fireEvent.press(screen.getByTestId('dm-word-filter-off'));
  expect(useFeedIgnoreStore.getState().dmFilterEnabled).toBe(false);
  expect(useFeedIgnoreStore.getState().dmFilterWords).toEqual(['bad']);
  expect(screen.queryByTestId('dm-word-filter-off')).toBeNull();
});
