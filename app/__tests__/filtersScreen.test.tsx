import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FiltersScreen } from '@/features/transactions/screens/FiltersScreen';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { CapsuleButtonFlat } from '@/shared/ui/composed/CapsuleButton/CapsuleButton.flat';
import { CapsuleButtonBlur } from '@/shared/ui/composed/CapsuleButton/CapsuleButton.blur';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockDismissTo = jest.fn();
let mockParams: Record<string, string> = {};

// Expo's node preset rewrites FlatList to this web host. Layout is outside this test.
jest.mock('react-native-web/dist/exports/FlatList', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({
      data,
      renderItem,
      ListFooterComponent,
    }: {
      data: string[];
      renderItem: (info: { item: string; index: number }) => React.ReactNode;
      ListFooterComponent?: React.ReactNode;
    }) => (
      <>
        {data.map((item, index) => (
          <React.Fragment key={item}>{renderItem({ item, index })}</React.Fragment>
        ))}
        {ListFooterComponent}
      </>
    ),
  };
});

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { dismissTo: (...args: unknown[]) => mockDismissTo(...args) },
}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({ useRouteParams: () => mockParams }));
jest.mock('@cashu/coco-react', () => ({
  useMints: () => ({
    trustedMints: [{ mintUrl: 'https://mint.example', mintInfo: { name: 'Example Mint' } }],
  }),
}));
jest.mock('@/features/transactions/hooks/useHistoryWithMelts', () => ({
  useHistoryWithMelts: () => ({ history: [] }),
}));
jest.mock('@/shared/lib/utils', () => ({ mintHistoryEntryExpired: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  useLifecycleLogger: jest.fn(),
  log: { info: jest.fn() },
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'rgb(128, 128, 128)') : 'rgb(128, 128, 128)',
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'View' },
  useSharedValue: (initial: boolean) => {
    let value = initial;
    return {
      get: () => value,
      set: (next: boolean) => {
        value = next;
      },
    };
  },
  useAnimatedStyle: (style: () => object) => style(),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: 'Pressable',
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: 'View',
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: 'View',
}));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: ({ text, ...props }: { text: React.ReactNode }) => {
    const React = jest.requireActual('react');
    return React.createElement('Pressable', props, React.createElement('Text', {}, text));
  },
}));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({ actionMenuSheet: jest.fn() }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: () => null }));
jest.mock('@/shared/ui/composed/BlurCardFrame', () => ({
  BlurCardFrame: 'View',
}));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({
  CapsuleButton: jest.requireActual('@/shared/ui/composed/CapsuleButton/CapsuleButton.flat')
    .CapsuleButtonFlat,
}));
jest.mock('heroui-native', () => {
  const React = jest.requireActual('react');
  return {
    PressableFeedback: Object.assign((props: object) => React.createElement('Pressable', props), {
      Ripple: () => null,
    }),
  };
});
jest.mock('@/assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

const options = {
  currency: ['all', 'sat', 'usd', 'eur', 'gbp'],
  type: ['all', 'lightning', 'ecash', 'onchain'],
  direction: ['all', 'incoming', 'outgoing'],
  status: ['all', 'confirmed', 'pending', 'expired'],
  source: ['all', 'qr', 'nfc', 'ble', 'paste', 'deeplink'],
  lock: ['all', 'locked', 'unlocked'],
  counterparty: ['all', 'with'],
  zap: ['all', 'zaps'],
  mint: ['all', 'https://mint.example'],
};
let renderer: TestRenderer.ReactTestRenderer;
function control(testID: string) {
  return renderer.root.find(
    (node) => typeof node.type === 'string' && node.props.testID === testID
  );
}
async function press(testID: string) {
  await act(async () => {
    await control(testID).props.onPress();
  });
}
beforeEach(() => {
  mockParams = {};
  mockDismissTo.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
});

it('renders every option as a named radio and changes the draft without navigating', async () => {
  act(() => {
    renderer = TestRenderer.create(<FiltersScreen />);
  });
  expect(renderer.root.findAllByProps({ testID: 'filters-reset' })).toHaveLength(0);
  for (const [section, values] of Object.entries(options)) {
    for (const value of values) {
      const id = `filter-${section}-${value}`;
      expect(control(id).props.accessibilityRole).toBe('radio');
      expect(control(id).props.accessibilityLabel).toBeTruthy();
      await press(id);
      expect(control(id).props.accessibilityState).toEqual({ checked: true, selected: true });
      expect(control(id).props.accessibilityValue).toEqual({ text: '1' });
      for (const other of values.filter((candidate) => candidate !== value)) {
        expect(control(`filter-${section}-${other}`).props.accessibilityState.checked).toBe(false);
      }
    }
  }
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(control('filters-reset')).toBeTruthy();
  await press('filters-apply');
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: '/transactions',
    params: {
      filterCurrency: 'gbp',
      filterPaymentType: 'onchain',
      filterDirection: 'outgoing',
      filterStatus: 'Expired',
      filterSource: 'deeplink',
      filterLock: 'unlocked',
      filterCounterparty: 'with',
      filterZap: 'zaps',
      filterMintUrl: 'https://mint.example',
    },
  });
});

it('restores route selections and resets every draft before applying defaults', async () => {
  mockParams = {
    currency: 'usd',
    paymentType: 'ecash',
    direction: 'incoming',
    status: 'Pending',
    source: 'qr',
    lock: 'locked',
    counterparty: 'with',
    zap: 'zaps',
    mintUrl: 'https://mint.example',
  };
  act(() => {
    renderer = TestRenderer.create(<FiltersScreen />);
  });
  for (const id of [
    'currency-usd',
    'type-ecash',
    'direction-incoming',
    'status-pending',
    'source-qr',
    'lock-locked',
    'counterparty-with',
    'zap-zaps',
    'mint-https://mint.example',
  ]) {
    expect(control(`filter-${id}`).props.accessibilityState.checked).toBe(true);
  }
  await press('filters-reset');
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ testID: 'filters-reset' })).toHaveLength(0);
  for (const section of Object.keys(options)) {
    expect(
      control(`filter-${section}-${section === 'currency' ? 'sat' : 'all'}`).props
        .accessibilityState.checked
    ).toBe(true);
  }
  await press('filters-apply');
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: '/transactions',
    params: {
      filterCurrency: 'sat',
      filterPaymentType: 'all',
      filterDirection: 'all',
      filterStatus: 'All',
      filterSource: 'all',
      filterLock: 'all',
      filterCounterparty: 'all',
      filterZap: 'all',
      filterMintUrl: 'all',
    },
  });
});

it('keeps plain PillTabs labels and values compatible with existing callers', async () => {
  const onTabChange = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <PillTabs
        tabs={['All', 'Recent']}
        activeTab="All"
        onTabChange={onTabChange}
        testIDFor={(tab) => `tab-${tab}`}
      />
    );
  });
  expect(control('tab-Recent').props.accessibilityLabel).toBe('Recent');
  await press('tab-Recent');
  expect(onTabChange).toHaveBeenCalledWith('Recent');
});

it.each([CapsuleButtonFlat, CapsuleButtonBlur])(
  'forwards capsule radio semantics to the press target (%p)',
  async (Capsule) => {
    const onPress = jest.fn();
    act(() => {
      renderer = TestRenderer.create(
        <Capsule label="Mint" testID="mint" isActive accessibilityRole="radio" onPress={onPress} />
      );
    });
    expect(control('mint').props.accessibilityRole).toBe('radio');
    expect(control('mint').props.accessibilityState).toEqual({ checked: true, selected: true });
    await press('mint');
    expect(onPress).toHaveBeenCalledTimes(1);
  }
);

it('exposes a disabled mint-preference segment without disabling Required', () => {
  act(() => {
    renderer = TestRenderer.create(
      <PillTabs
        tabs={['Required', 'Preferred']}
        activeTab="Required"
        onTabChange={jest.fn()}
        accessibilityRole="radio"
        testIDFor={(tab) => `mode-${tab}`}
        disabledFor={(tab) => tab === 'Preferred'}
      />
    );
  });
  expect(control('mode-Preferred').props.disabled).toBe(true);
  expect(control('mode-Preferred').props.accessibilityState).toEqual({
    checked: false,
    selected: false,
    disabled: true,
  });
  expect(control('mode-Required').props.disabled).toBe(false);
  expect(control('mode-Required').props.accessibilityState.checked).toBe(true);
});
