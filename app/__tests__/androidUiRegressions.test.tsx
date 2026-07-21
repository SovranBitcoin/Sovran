/**
 * @jest-environment node
 */

import React from 'react';
import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { TransactionLocationSection } from '@/features/transactions/components/TransactionLocationSection';
import { FiatCurrencyPillAndroidMenu } from '@/features/wallet/components/FiatCurrencyPill/FiatCurrencyPill.androidMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSetDisplayCurrency = jest.fn();
const mockActionMenuPopup = jest.fn();
const mockLocationSectionState = {
  location: { latitude: 51.5, longitude: -0.12 },
  isRevealed: false,
  reveal: jest.fn(),
};

jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: (...args: unknown[]) => mockActionMenuPopup(...args),
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => token) : tokens,
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (
    selector: (state: { displayCurrency: string; setDisplayCurrency: jest.Mock }) => unknown
  ) => selector({ displayCurrency: 'usd', setDisplayCurrency: mockSetDisplayCurrency }),
}));

jest.mock('@/shared/hooks/useTransactionLocationSection', () => ({
  useTransactionLocationSection: () => mockLocationSectionState,
}));

jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Pressable', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('View', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('HStack', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('VStack', props, children);
  },
}));

jest.mock('@/shared/blocks/popup/MenuScrim', () => ({
  MenuScrim: () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('MenuScrim');
  },
}));

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { testID: `icon-${name}`, ...props });
  },
}));

jest.mock('hex-color-opacity', () =>
  jest.fn((color: string, value: number) => `${color}/${value}`)
);

jest.mock('expo-blur', () => ({
  BlurView: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('BlurView', props);
  },
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('LinearGradient', props);
  },
}));

jest.mock('expo-maps', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    AppleMaps: {
      View: (props: Record<string, unknown>) => ReactActual.createElement('AppleMaps.View', props),
    },
    GoogleMaps: {
      MapColorScheme: { DARK: 'dark' },
      View: (props: Record<string, unknown>) => ReactActual.createElement('GoogleMaps.View', props),
    },
  };
});

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Menu = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu', props, children);

  Menu.Trigger = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Trigger', props, children);
  Menu.Portal = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Portal', props, children);
  Menu.Content = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Content', props, children);
  Menu.Label = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Label', props, children);
  Menu.Item = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Item', props, children);
  Menu.ItemTitle = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.ItemTitle', props, children);

  return { Menu };
});

function findAllByType(renderer: TestRenderer.ReactTestRenderer, type: string) {
  return renderer.root.findAll((node) => node.type === type);
}

describe('Android UI regressions', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSetDisplayCurrency.mockReset();
    mockActionMenuPopup.mockReset();
    mockLocationSectionState.isRevealed = false;
    mockLocationSectionState.reveal.mockReset();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders no inline sheet at rest and dispatches the global currency menu on tap', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <FiatCurrencyPillAndroidMenu displayText="≈ $12.34" enableCurrencyMenu />
      );
    });

    // Regression: the pill renders NO inline bottom-sheet (which paints at rest
    // on Android). The pick-one surface is the app-wide actionMenuPopup() host.
    expect(findAllByType(renderer!, 'Menu.Portal')).toHaveLength(0);
    expect(findAllByType(renderer!, 'Menu.Content')).toHaveLength(0);
    expect(mockActionMenuPopup).not.toHaveBeenCalled();

    // The pill is the trigger — pressing it dispatches the global action menu.
    act(() => {
      findAllByType(renderer!, 'Pressable')[0].props.onPress();
    });

    expect(mockActionMenuPopup).toHaveBeenCalledTimes(1);
    const payload = mockActionMenuPopup.mock.calls[0][0] as {
      title: string;
      buttons: {
        testID?: string;
        accessibilityLabel?: string;
        accessibilityHint?: string;
        suffix?: unknown;
        onPress: () => void;
      }[];
    };
    expect(payload.title).toBe('Display currency');
    expect(payload.buttons).toHaveLength(3);
    // displayCurrency mock is 'usd' → the USD row carries the selected-check suffix.
    const usd = payload.buttons.find((b) => b.testID === 'fiat-currency-menu-usd');
    expect(usd?.suffix).toBeTruthy();
    expect(usd).toMatchObject({ accessibilityLabel: 'USD', accessibilityHint: 'US Dollar' });

    const eur = payload.buttons.find((b) => b.testID === 'fiat-currency-menu-eur');
    expect(eur).toMatchObject({ accessibilityLabel: 'EUR', accessibilityHint: 'Euro' });
    act(() => {
      eur?.onPress();
    });
    expect(mockSetDisplayCurrency).toHaveBeenCalledWith('eur');
  });

  it('does not mount map previews, blur, or gradients for Android location privacy placeholder', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<TransactionLocationSection transactionId="tx-1" />);
    });

    expect(findAllByType(renderer!, 'AppleMaps.View')).toHaveLength(0);
    expect(findAllByType(renderer!, 'GoogleMaps.View')).toHaveLength(0);
    expect(findAllByType(renderer!, 'BlurView')).toHaveLength(0);
    expect(findAllByType(renderer!, 'LinearGradient')).toHaveLength(0);
    expect(findAllByType(renderer!, 'Pressable')).toHaveLength(1);

    act(() => {
      findAllByType(renderer!, 'Pressable')[0].props.onPress();
    });
    expect(mockLocationSectionState.reveal).toHaveBeenCalledTimes(1);
  });
});
