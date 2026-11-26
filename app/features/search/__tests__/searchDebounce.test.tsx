/**
 * One wait between a keystroke and the remote people search: the field emits
 * every keystroke (as iOS's native bar does), and `useContactSearch` keeps the
 * only 250 ms pause. Before, Android's field waited 300 ms and the search
 * another 350 ms on top: 650 ms before anything was asked.
 */
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { SEARCH_DEBOUNCE_MS } from '@/features/payments/hooks/useContactSearch';
import { SearchLayout } from '@/shared/ui/composed/SearchLayout';

const mockFieldProps: Record<string, unknown>[] = [];

jest.mock('@/runtime/nostrClient', () => ({
  useNostrClient: () => ({ client: undefined, isInitialized: false }),
}));

jest.mock('expo-router', () => {
  function Stack({ children }: { children: unknown }) {
    return children;
  }
  Stack.Screen = function Screen({ options }: { options: { headerTitle?: () => unknown } }) {
    return options.headerTitle ? options.headerTitle() : null;
  };
  return { Stack };
});
jest.mock('@/navigation/nativeTabs', () => ({
  buildExpoRouterHeaderOptions: ({ options }: { options: unknown }) => options,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { raw: {} } }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map(() => 'rgb(0, 0, 0)'),
}));
jest.mock('@/shared/ui/composed/GlassSearchBar', () => ({
  GlassSearchBar: (props: Record<string, unknown>) => {
    mockFieldProps.push(props);
    return null;
  },
}));

describe('Search field debounce', () => {
  const realOS = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  });

  it('emits every keystroke on Android, with the e2e id and label', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    render(
      <SearchLayout
        title="Search"
        placeholder="People, mints or places"
        searchTestID="search-input"
      />
    );
    const props = mockFieldProps[mockFieldProps.length - 1];
    expect(props).toBeDefined();
    expect(props?.debounceMs).toBeUndefined();
    expect(props?.testID).toBe('search-input');
    expect(props?.placeholder).toBe('People, mints or places');
  });

  it('waits 250 ms once before the remote people search', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(250);
  });
});
