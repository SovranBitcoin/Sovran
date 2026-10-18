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
const mockPickOption = jest.fn(async (_request: unknown): Promise<string | null> => null);
const mockTransactionLocation = { latitude: 51.5, longitude: -0.12 };

jest.mock('@/shared/lib/picker/openPicker', () => ({
  pickOption: (request: unknown) => mockPickOption(request),
}));

jest.mock('@/shared/ui/capability', () => ({
  useCapabilities: () => ({ liquidGlass: false, frostedSurface: false }),
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

// Reveal is local `useState` in the component now; only the stored location
// comes from outside, so that is all this needs to supply.
jest.mock('@/shared/stores/profile/transactionLocationStore', () => ({
  useTransactionLocation: () => mockTransactionLocation,
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

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn((color: string, value: number) => `${color}/${value}`),
}));

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
    mockPickOption.mockClear();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders no inline sheet at rest and opens the picker sheet on tap', async () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <FiatCurrencyPillAndroidMenu displayText="≈ $12.34" enableCurrencyMenu />
      );
    });

    // Regression: the pill renders NO inline bottom-sheet (which paints at rest
    // on Android). The pick-one surface is the picker sheet.
    expect(findAllByType(renderer!, 'Menu.Portal')).toHaveLength(0);
    expect(findAllByType(renderer!, 'Menu.Content')).toHaveLength(0);
    expect(mockPickOption).not.toHaveBeenCalled();

    // The pill is the trigger — pressing it opens the picker; the person picks EUR.
    mockPickOption.mockResolvedValueOnce('eur');
    await act(async () => {
      findAllByType(renderer!, 'Pressable')[0].props.onPress();
    });

    expect(mockPickOption).toHaveBeenCalledTimes(1);
    const request = mockPickOption.mock.calls[0][0] as {
      title: string;
      options: {
        testID: string;
        accessibilityLabel?: string;
        accessibilityHint?: string;
        selected?: boolean;
      }[];
    };
    expect(request.title).toBe('Display currency');
    expect(request.options).toHaveLength(3);
    // displayCurrency mock is 'usd' → the USD row is the selected one.
    const usd = request.options.find((o) => o.testID === 'fiat-currency-menu-usd');
    expect(usd).toMatchObject({
      selected: true,
      accessibilityLabel: 'USD',
      accessibilityHint: 'US Dollar',
    });
    const eur = request.options.find((o) => o.testID === 'fiat-currency-menu-eur');
    expect(eur).toMatchObject({
      selected: false,
      accessibilityLabel: 'EUR',
      accessibilityHint: 'Euro',
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

    // Reveal is local state now, so the observable effect is that the
    // tap-to-reveal placeholder is gone. Asserting the map mounts instead
    // would be environment-dependent: Android only renders GoogleMaps.View
    // when a Maps API key is configured.
    act(() => {
      findAllByType(renderer!, 'Pressable')[0].props.onPress();
    });
    expect(findAllByType(renderer!, 'Pressable')).toHaveLength(0);
  });
});
