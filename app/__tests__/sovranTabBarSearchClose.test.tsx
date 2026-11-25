/**
 * The open Search tab is the way out of Search: pressing it again closes it
 * (back to the tab the person came from) instead of doing nothing, and it says
 * so to screen readers.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SearchTabIcon, SovranTabBar } from '@/shared/blocks/SovranTabBar';

const mockHaptic = jest.fn();
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { navigateHaptic: () => mockHaptic() },
}));
jest.mock('@/shared/hooks/useScreenInsets', () => ({ useReportTabBarHeight: () => undefined }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: unknown) => (Array.isArray(token) ? token.map(() => 'black') : 'black'),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/ui/primitives/PressScale', () => ({
  PressScale: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Pressable: ({ children, ...props }: { children: import('react').ReactNode }) =>
      createElement('View', props, children),
  };
});
jest.mock('@/shared/ui/primitives/Text', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Text: ({ children }: { children: import('react').ReactNode }) =>
      createElement('Text', null, children),
  };
});
jest.mock('assets/icons', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => createElement('View', { testID: `icon:${name}` }),
  };
});
jest.mock('react-native-reanimated', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: import('react').ReactNode }) =>
        createElement('View', props, children),
    },
    Easing: { out: () => undefined, cubic: undefined },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ get: () => value, set: () => undefined }),
    withTiming: (value: number) => value,
  };
});

const routes = [
  { key: 'index-key', name: 'index' },
  { key: 'settings-key', name: 'settings' },
  { key: 'search-key', name: 'search' },
];
const descriptor = (title: string, testID: string, search = false) => ({
  options: {
    title,
    tabBarAccessibilityLabel: title,
    tabBarButtonTestID: testID,
    tabBarIcon: ({ focused, color }: { focused: boolean; color: string }) =>
      search ? <SearchTabIcon focused={focused} color={color} /> : null,
  },
});
const descriptors = {
  'index-key': descriptor('Wallet', 'tab-wallet'),
  'settings-key': descriptor('Settings', 'tab-settings'),
  'search-key': descriptor('Search', 'tab-search', true),
};

const navigation = {
  emit: jest.fn(() => ({ defaultPrevented: false })),
  navigate: jest.fn(),
};

const renderBar = (focusedIndex: number, onCloseRoute = jest.fn()) => {
  const state = { index: focusedIndex, routes };
  render(
    <SovranTabBar
      state={state as never}
      descriptors={descriptors as never}
      navigation={navigation as never}
      insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      closeableRoute="search"
      onCloseRoute={onCloseRoute}
      closeLabel="Close search"
      closeHint="Returns to Settings"
    />
  );
  return onCloseRoute;
};

beforeEach(() => jest.clearAllMocks());

describe('Search tab', () => {
  it('opens Search from another tab as any tab does', () => {
    const onCloseRoute = renderBar(1);
    const search = screen.getByTestId('tab-search');
    expect(search.props.accessibilityLabel).toBe('Search');
    expect(search.props.accessibilityHint).toBeUndefined();
    expect(screen.getByTestId('tab-search-icon')).toBeTruthy();

    fireEvent.press(search);
    expect(navigation.navigate).toHaveBeenCalledWith('search', undefined);
    expect(onCloseRoute).not.toHaveBeenCalled();
  });

  it('closes Search when pressed while open, with the same haptic', () => {
    const onCloseRoute = renderBar(2);
    const search = screen.getByTestId('tab-search');
    expect(search.props.accessibilityLabel).toBe('Close search');
    expect(search.props.accessibilityHint).toBe('Returns to Settings');
    expect(screen.getByTestId('tab-search-close-icon')).toBeTruthy();
    expect(screen.getByTestId('icon:material-symbols:close-rounded')).toBeTruthy();
    // The visible label still names the tab.
    expect(screen.getByText('Search')).toBeTruthy();

    fireEvent.press(search);
    expect(onCloseRoute).toHaveBeenCalledTimes(1);
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('leaves the other open tabs alone when pressed again', () => {
    const onCloseRoute = renderBar(0);
    expect(screen.getByTestId('tab-wallet').props.accessibilityLabel).toBe('Wallet');
    fireEvent.press(screen.getByTestId('tab-wallet'));
    expect(onCloseRoute).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
