/**
 * The Search header closes on the right, where iOS's Cancel sits while typing:
 * no profile button on the left, an X on the right that lets an active native
 * search controller go and then returns to the tab Search was opened from
 * (Wallet without a tab navigator). On Android the field stops short of it.
 */
import { render } from '@testing-library/react-native';
import { Platform, useWindowDimensions } from 'react-native';

import {
  getHeaderTitleWidthBesideRightButton,
  HEADER_LAYOUT,
} from '@/features/wallet/lib/walletHeader';
import { SearchCloseProvider, SearchLayout } from '@/shared/ui/composed/SearchLayout';

type HeaderOptions = {
  headerLeft?: () => unknown;
  headerRight?: () => unknown;
  headerTitle?: () => unknown;
};

let mockOptions: HeaderOptions = {};
const mockActionProps: Record<string, unknown>[] = [];
const mockFieldProps: Record<string, unknown>[] = [];
const mockRawNavigate = jest.fn();
const mockDismissOrder: string[] = [];

jest.mock('@/runtime/nostrClient', () => ({
  useNostrClient: () => ({ client: undefined, isInitialized: false }),
}));
jest.mock('expo-router', () => {
  function Stack({ children }: { children: unknown }) {
    return children;
  }
  Stack.Screen = function Screen({ options }: { options: HeaderOptions }) {
    mockOptions = options;
    return [options.headerRight?.() ?? null, options.headerTitle?.() ?? null];
  };
  return { Stack };
});
jest.mock('@/navigation/nativeTabs', () => ({
  buildExpoRouterHeaderOptions: ({
    options,
    headerLeft,
    headerRight,
  }: {
    options: object;
    headerLeft?: () => unknown;
    headerRight?: () => unknown;
  }) => ({ ...options, headerLeft, headerRight }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map(() => 'rgb(0, 0, 0)'),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { raw: { navigate: (...args: unknown[]) => mockRawNavigate(...args) } },
}));
jest.mock('@/shared/ui/composed/search/nativeSearchDismiss', () => ({
  runAfterNativeSearchDismiss: (navigate: () => void) => {
    mockDismissOrder.push('dismiss');
    navigate();
  },
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: (props: Record<string, unknown>) => {
    mockActionProps.push(props);
    return null;
  },
}));
jest.mock('@/shared/ui/composed/GlassSearchBar', () => ({
  GlassSearchBar: (props: Record<string, unknown>) => {
    mockFieldProps.push(props);
    return null;
  },
}));

const layout = <SearchLayout title="Search" placeholder="People, mints or places" />;
const closeButton = () => mockActionProps[mockActionProps.length - 1] ?? {};
const press = () => (closeButton().onPress as () => void)();

describe('the Search header close button', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    mockOptions = {};
    mockActionProps.length = 0;
    mockFieldProps.length = 0;
    mockDismissOrder.length = 0;
    mockRawNavigate.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  });

  it('sits on the right, with no profile button on the left', () => {
    render(layout);
    expect(mockOptions.headerLeft).toBeUndefined();
    expect(mockOptions.headerRight).toBeDefined();
    expect(closeButton()).toMatchObject({
      icon: 'material-symbols:close-rounded',
      testID: 'search-close',
    });
  });

  it('returns to the tab Search was opened from, after the native search lets go', () => {
    const close = jest.fn(() => mockDismissOrder.push('close'));
    render(
      <SearchCloseProvider
        value={{ close, accessibilityLabel: 'Close search. Returns to Settings' }}>
        {layout}
      </SearchCloseProvider>
    );
    expect(closeButton().accessibilityLabel).toBe('Close search. Returns to Settings');
    press();
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockDismissOrder).toEqual(['dismiss', 'close']);
    expect(mockRawNavigate).not.toHaveBeenCalled();
  });

  it('falls back to Wallet without a tab navigator', () => {
    render(layout);
    expect(closeButton().accessibilityLabel).toBe('Close search. Returns to Wallet');
    press();
    expect(mockRawNavigate).toHaveBeenCalledWith('/(drawer)/(tabs)/index');
  });

  it('keeps the Android field clear of the close button', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    render(layout);
    let window = 0;
    function WindowProbe() {
      window = useWindowDimensions().width;
      return null;
    }
    render(<WindowProbe />);
    const width = mockFieldProps[mockFieldProps.length - 1]?.width as number;
    expect(width).toBe(getHeaderTitleWidthBesideRightButton(window));
    // Edge padding, the field, the gap, the close button and edge padding fit the window.
    const { HORIZONTAL_PADDING, BUTTON_SPACING, TOOLBAR_BUTTON_WIDTH } = HEADER_LAYOUT;
    expect(
      HORIZONTAL_PADDING + width + BUTTON_SPACING + TOOLBAR_BUTTON_WIDTH + HORIZONTAL_PADDING
    ).toBeLessThanOrEqual(window);
  });
});
