/**
 * @jest-environment node
 *
 * Pins the iOS 26 Search -> Profile -> Back native tab bar protection:
 * - When an iOS `Stack.SearchBar` (`UISearchController`) is active, pushing a
 *   profile calls `cancelSearch()` first and waits two frames before pushing
 *   so UIKit finishes restoring the bottom native tabs.
 * - The synthetic `onCancelButtonPress` + `onChangeText('')` emitted by
 *   `cancelSearch()` does NOT wipe `searchQuery`; returning to Search keeps
 *   the results, and refocusing restores the query into the native field.
 * - A real user cancel still clears `searchQuery`.
 * - Callback identities on `Stack.SearchBar` remain stable across keystrokes
 *   so `headerSearchBarOptions` is not re-applied mid-typing.
 */
import { Keyboard, Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { navigateToProfile } from '@/features/search/lib/navigateToProfile';
import { SearchScreen } from '@/features/search/screens/SearchScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SearchBarCapturedProps = {
  ref?: { current: { cancelSearch: () => void; setText: (text: string) => void } | null };
  onFocus?: () => void;
  onChangeText?: (event: { nativeEvent: { text: string } }) => void;
  onCancelButtonPress?: () => void;
};

let mockSearchBarProps: SearchBarCapturedProps = {};
let mockSearchQuery = '';
const mockOnSearchChange = jest.fn((next: string) => {
  mockSearchQuery = next;
});
const mockRouterPush = jest.fn();
const mockKeyboardDismiss = jest.fn();
const mockSetText = jest.fn();
const mockCancelSearch = jest.fn(() => {
  // Mirror RNSSearchBar.mm: cancelSearch emits onCancelButtonPress then onChangeText('').
  mockSearchBarProps.onCancelButtonPress?.();
  mockSearchBarProps.onChangeText?.({ nativeEvent: { text: '' } });
});
let mockFocusCleanup: (() => void) | undefined;

jest.mock('expo-router', () => ({
  Stack: {
    SearchBar: (props: SearchBarCapturedProps) => {
      mockSearchBarProps = props;
      if (props.ref) {
        props.ref.current = {
          cancelSearch: mockCancelSearch,
          setText: mockSetText,
        };
      }
      return null;
    },
  },
  useFocusEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  },
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => ['theme-foreground', 'theme-muted'],
}));

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  useLifecycleLogger: jest.fn(),
  paymentLog: { info: jest.fn() },
  mintUrlLogFields: () => ({}),
}));

jest.mock('@/shared/ui/composed/SearchLayout', () => ({
  useSearchContext: () => ({
    placeholder: 'People, mints or places',
    clearKey: 0,
    seedText: '',
    searchQuery: mockSearchQuery,
    onSearchChange: mockOnSearchChange,
  }),
}));

jest.mock('@/shared/ui/composed/search/UnifiedSearch', () => ({
  UnifiedSearch: () => null,
}));

jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: (props: Record<string, unknown>) => ReactActual.createElement('View', props),
  };
});

describe('iOS native search bar dismissal before navigation', () => {
  let frames: FrameRequestCallback[];
  const originalRaf = global.requestAnimationFrame;
  const originalPlatformOS = Platform.OS;
  let dismissSpy: jest.SpyInstance;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {
      mockKeyboardDismiss();
    });
    frames = [];
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as typeof requestAnimationFrame;
    mockSearchBarProps = {};
    mockSearchQuery = '';
    mockFocusCleanup = undefined;
    mockOnSearchChange.mockClear();
    mockRouterPush.mockClear();
    mockKeyboardDismiss.mockClear();
    mockCancelSearch.mockClear();
    mockSetText.mockClear();
  });

  afterEach(() => {
    dismissSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
    global.requestAnimationFrame = originalRaf;
  });

  it('cancels the active UISearchController before pushing profile, preserves query, and restores text on refocus', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SearchScreen />);
    });

    const initialOnChange = mockSearchBarProps.onChangeText;
    const initialOnCancel = mockSearchBarProps.onCancelButtonPress;
    const initialOnFocus = mockSearchBarProps.onFocus;

    // User focuses Search and types a profile name.
    act(() => {
      mockSearchBarProps.onFocus?.();
      mockSearchBarProps.onChangeText?.({ nativeEvent: { text: 'kelbie' } });
    });
    expect(mockSearchQuery).toBe('kelbie');

    // Rerendering with updated query keeps Stack.SearchBar callbacks identical.
    act(() => {
      renderer.update(<SearchScreen />);
    });
    expect(mockSearchBarProps.onChangeText).toBe(initialOnChange);
    expect(mockSearchBarProps.onCancelButtonPress).toBe(initialOnCancel);
    expect(mockSearchBarProps.onFocus).toBe(initialOnFocus);

    // Tapping a profile deactivates the native search controller BEFORE pushing,
    // without wiping the JS query or results.
    act(() => {
      navigateToProfile('abcdef');
      // Duplicate tap during the settle window must not push prematurely.
      navigateToProfile('abcdef');
    });
    expect(mockKeyboardDismiss).toHaveBeenCalled();
    expect(mockCancelSearch).toHaveBeenCalledTimes(1);
    expect(mockSearchQuery).toBe('kelbie');
    expect(mockRouterPush).not.toHaveBeenCalled();

    // Flush the two animation frames -> push fires cleanly after UIKit settles.
    act(() => {
      frames.shift()?.(16);
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    act(() => {
      frames.shift()?.(32);
    });
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/profile',
      params: { pubkey: 'abcdef' },
    });

    // Returning to Search and tapping the search field restores the preserved query.
    act(() => {
      mockSearchBarProps.onFocus?.();
    });
    expect(mockSetText).toHaveBeenCalledWith('kelbie');

    // A real user tap on Cancel still clears the query.
    act(() => {
      mockSearchBarProps.onCancelButtonPress?.();
      mockSearchBarProps.onChangeText?.({ nativeEvent: { text: '' } });
    });
    expect(mockSearchQuery).toBe('');

    act(() => renderer.unmount());
  });

  it('pushes synchronously when the native search controller is not active and cleans up on blur', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SearchScreen />);
    });

    // Tapping a recent person without activating the search field pushes immediately.
    act(() => {
      navigateToProfile('123456');
    });
    expect(mockCancelSearch).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledTimes(1);

    // If search IS active and the screen blurs via another route, cleanup cancels it.
    act(() => {
      mockSearchBarProps.onFocus?.();
      mockFocusCleanup?.();
    });
    expect(mockCancelSearch).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });
});
