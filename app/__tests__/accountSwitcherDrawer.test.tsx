/**
 * The account switcher drawer (ADR 0035): what each row says, that the check
 * follows the confirmed account only, that one lock holds every account action
 * across a switch, and that menus wait for the drawer to close.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import {
  accountSecondaryLine,
  accountsCountLabel,
  formatCachedBalance,
  UNKNOWN_BALANCE,
} from '@/navigation/accountSwitcher';

const mockState = {
  profiles: [
    { accountIndex: 0, pubkey: 'a'.repeat(64), addedAt: 1, cachedBalanceSats: 2100 },
    { accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 2, cachedDisplayName: 'Second' },
    {
      accountIndex: 77,
      pubkey: 'c'.repeat(64),
      addedAt: 3,
      source: 'imported',
      cachedBalanceSats: 0,
    },
  ],
  activeAccountIndex: 0,
};
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: Object.assign(
    (selector: (state: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState }
  ),
}));
const mockSettings = { displayBtc: 2 };
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof mockSettings) => unknown) => selector(mockSettings),
    { getState: () => mockSettings }
  ),
}));

const mockSwitch = jest.fn();
const mockCreate = jest.fn();
const mockImport = jest.fn();
jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  switchToExistingProfile: (...args: unknown[]) => mockSwitch(...args),
  createAndSwitchProfile: (...args: unknown[]) => mockCreate(...args),
  importAndSwitchProfile: (...args: unknown[]) => mockImport(...args),
}));

const mockActionMenu = jest.fn();
const mockOpenImport = jest.fn();
const mockStaticPopup = jest.fn();
jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: (...args: unknown[]) => mockActionMenu(...args),
  openProfileImportMenu: (...args: unknown[]) => mockOpenImport(...args),
  staticPopup: (...args: unknown[]) => mockStaticPopup(...args),
  copyPopup: jest.fn(),
}));

// The drawer reads as already closed, so a close-wait resolves at once.
jest.mock('expo-router/drawer', () => ({ useDrawerProgress: () => ({ get: () => 0 }) }));
jest.mock('react-native-reanimated', () => ({
  runOnJS: (fn: unknown) => fn,
  useAnimatedReaction: () => undefined,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn(), push: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: unknown) => (Array.isArray(token) ? token.map(() => 'black') : 'black'),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useCachedNostrProfile: () => ({ metadata: undefined, isStale: false, isMissing: true }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/shared/lib/identity', () => ({
  resolveIdentityName: ({ pubkey, overrideName }: { pubkey: string; overrideName?: string }) =>
    overrideName ?? `name-${pubkey.slice(0, 1)}`,
}));
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { navigateHaptic: jest.fn(), buttonHaptic: jest.fn() },
}));
jest.mock('@/shared/ui/primitives/PressScale', () => ({
  PressScale: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
// Plain host elements, so the test reads what the drawer decides: which rows,
// what words, what a tap does. The Pressable keeps its handlers and state.
jest.mock('@/shared/ui/primitives/Spinner', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return { Spinner: () => createElement('View', { testID: 'row-spinner' }) };
});
jest.mock('assets/icons', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => createElement('View', { testID: `icon:${name}` }),
  };
});
jest.mock('@/shared/ui/primitives/Text', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Text: ({ children }: { children: import('react').ReactNode }) =>
      createElement('Text', null, children),
  };
});
jest.mock('@/shared/ui/primitives/View/View', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    View: ({ children }: { children: import('react').ReactNode }) =>
      createElement('View', null, children),
  };
});
jest.mock('@/shared/ui/primitives/Pressable', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Pressable: ({ children, ...props }: { children: import('react').ReactNode }) =>
      createElement('View', props, children),
  };
});

import { AccountSwitcherDrawer } from '@/navigation/AccountSwitcherDrawer';

const navigation = { closeDrawer: jest.fn() };
const renderDrawer = () => render(<AccountSwitcherDrawer navigation={navigation as never} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockState.activeAccountIndex = 0;
});

describe('account row wording', () => {
  it('shows an unrecorded balance as unknown, never as zero, and keeps a real zero', () => {
    expect(formatCachedBalance(undefined, 2)).toBe(UNKNOWN_BALANCE);
    expect(formatCachedBalance(null, 2)).toBe(UNKNOWN_BALANCE);
    expect(formatCachedBalance(Number.NaN, 2)).toBe(UNKNOWN_BALANCE);
    expect(formatCachedBalance(0, 2)).toBe('0 sats');
    expect(formatCachedBalance(2100, 2)).toBe('2,100 sats');
  });

  it('prefers the NIP-05 handle and falls back to a shortened npub', () => {
    expect(accountSecondaryLine('a'.repeat(64), 'alice@example.com')).toBe('alice@example.com');
    expect(accountSecondaryLine('a'.repeat(64), '_@example.com')).toBe('@example.com');
    expect(accountSecondaryLine('a'.repeat(64))).toMatch(/^npub1.+….+$/);
  });

  it('counts accounts', () => {
    expect(accountsCountLabel(1)).toBe('1 account');
    expect(accountsCountLabel(3)).toBe('3 accounts');
  });
});

describe('AccountSwitcherDrawer', () => {
  it('lists every account with its balance and checks only the active one', () => {
    renderDrawer();
    expect(screen.getByText('3 accounts')).toBeTruthy();
    expect(screen.getByText('2,100 sats')).toBeTruthy();
    expect(screen.getByText(UNKNOWN_BALANCE)).toBeTruthy();
    expect(screen.getByText('0 sats')).toBeTruthy();
    expect(screen.getAllByTestId('icon:fluent:checkmark-16-filled')).toHaveLength(1);
    expect(screen.getByTestId('drawer-profile-switch-0').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('drawer-profile-switch-77').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('only closes the drawer when the active account is tapped', () => {
    renderDrawer();
    fireEvent.press(screen.getByTestId('drawer-profile-switch-0'));
    expect(navigation.closeDrawer).toHaveBeenCalled();
    expect(mockSwitch).not.toHaveBeenCalled();
  });

  it('locks every account action while a switch runs, and the check does not move', async () => {
    let finish!: (switched: boolean) => void;
    mockSwitch.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    renderDrawer();

    fireEvent.press(screen.getByTestId('drawer-profile-switch-77'));
    expect(mockSwitch).toHaveBeenCalledWith({ accountIndex: 77 });
    expect(screen.getByTestId('row-spinner')).toBeTruthy();
    // Still the confirmed account, not the tapped one.
    expect(screen.getByTestId('drawer-profile-switch-0').props.accessibilityState).toMatchObject({
      selected: true,
      disabled: true,
    });
    expect(screen.getByTestId('drawer-profile-switch-77').props.accessibilityState).toMatchObject({
      selected: false,
      busy: true,
    });

    fireEvent.press(screen.getByTestId('drawer-profile-switch-1'));
    fireEvent.press(screen.getByTestId('drawer-add-account'));
    fireEvent.press(screen.getByTestId('drawer-import-account'));
    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockOpenImport).not.toHaveBeenCalled();

    // A refused switch releases the lock and says why, once the drawer is shut.
    await act(async () => finish(false));
    expect(mockStaticPopup).toHaveBeenCalledWith('wallet-still-loading');
    expect(screen.queryByTestId('row-spinner')).toBeNull();
    expect(screen.getByTestId('drawer-profile-switch-1').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('keeps the lock through a switch that restarts the app', async () => {
    mockSwitch.mockResolvedValue(true);
    renderDrawer();
    await act(async () => {
      fireEvent.press(screen.getByTestId('drawer-profile-switch-1'));
    });
    // The store still names account 0: the restart has not happened yet.
    expect(screen.getByTestId('row-spinner')).toBeTruthy();
    fireEvent.press(screen.getByTestId('drawer-add-account'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('adds an account after the drawer has closed', async () => {
    mockCreate.mockResolvedValue(false);
    renderDrawer();
    await act(async () => {
      fireEvent.press(screen.getByTestId('drawer-add-account'));
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('opens the import form, and a refused import releases the lock', async () => {
    mockImport.mockResolvedValue('exists');
    renderDrawer();
    await act(async () => {
      fireEvent.press(screen.getByTestId('drawer-import-account'));
    });
    expect(mockOpenImport).toHaveBeenCalledTimes(1);
    const { onImport } = mockOpenImport.mock.calls[0][0];
    const request = { nsec: 'nsec1x', pubkeyHex: 'd'.repeat(64), accountIndex: 9 };
    await act(async () => onImport(request));
    expect(mockImport).toHaveBeenCalledWith(request);
    expect(mockStaticPopup).toHaveBeenCalledWith(
      'key-import-failed',
      expect.objectContaining({ text: 'This identity already exists as a profile.' })
    );
    expect(screen.getByTestId('drawer-add-account').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('offers copy, view and, for the active account only, edit on long press', async () => {
    renderDrawer();
    await act(async () => {
      fireEvent(screen.getByTestId('drawer-profile-switch-0'), 'longPress');
    });
    const active = mockActionMenu.mock.calls[0][0].buttons.map((b: { text: string }) => b.text);
    expect(active).toEqual(['Copy npub', 'View profile', 'Edit profile']);

    await act(async () => {
      fireEvent(screen.getByTestId('drawer-profile-switch-1'), 'longPress');
    });
    const other = mockActionMenu.mock.calls[1][0].buttons.map((b: { text: string }) => b.text);
    expect(other).toEqual(['Copy npub', 'View profile']);
    expect(mockSwitch).not.toHaveBeenCalled();
  });
});
