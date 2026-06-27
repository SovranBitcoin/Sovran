/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ContactRow, bleIdentity } from '@/shared/ui/composed/ContactRow';
import { ListRow } from '@/shared/ui/composed/ListRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : 'theme-single',
}));

jest.mock('hex-color-opacity', () => jest.fn(() => 'rgba(0,0,0,0.12)'));

jest.mock('@/shared/lib/date', () => ({
  formatRelative: jest.fn(() => 'recently'),
}));

jest.mock('@/shared/stores/global/settingsStore', () => {
  const state = {
    language: 'en',
    avatarFallbackVariant: 'beam',
    getDisplayBtc: () => 'sats',
  };
  const useSettingsStore = Object.assign(
    jest.fn((selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state)),
    {
      getState: () => state,
      subscribe: jest.fn(() => jest.fn()),
    }
  );

  return { useSettingsStore };
});

jest.mock('@/shared/ui/composed/ListRow', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    ListRow: jest.fn((props: Record<string, unknown>) =>
      ReactActual.createElement(View, { testID: 'list-row', ...props })
    ),
  };
});

jest.mock('@/shared/ui/primitives/Avatar', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    Avatar: (props: Record<string, unknown>) =>
      ReactActual.createElement(View, { testID: 'avatar', ...props }),
  };
});

jest.mock('@/shared/ui/primitives/Text', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  // RN 0.85: requireActual Text pulls Pressability → Platform.OS, which throws
  // under the node test env. Use the jest-mocked Text instead.
  const { Text } = jest.requireMock<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(Text, props, children),
  };
});

jest.mock('@/shared/ui/primitives/Pressable', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    Pressable: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

jest.mock('@/shared/ui/primitives/Spinner', () => ({
  Spinner: () => null,
}));

jest.mock('@/shared/ui/primitives/View/HStack', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    HStack: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

jest.mock('@/shared/ui/primitives/View/View', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    View,
  };
});

jest.mock('@/shared/ui/primitives/SelectableCheck', () => ({
  SelectableCheck: () => null,
}));

jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AmountFormatter: () => null,
}));

jest.mock('@/shared/ui/composed/RowStatsAccent', () => ({
  RowStatsAccent: () => null,
  STAT_ICONS: {
    score: 'score',
    audit: 'audit',
    reputation: 'reputation',
    followers: 'followers',
    offline: 'offline',
  },
  STAT_COLOR_SOCIAL: 'social',
  STAT_COLOR_ERROR: 'error',
}));

jest.mock(
  'assets/icons',
  () => ({
    __esModule: true,
    default: ({ name, ...props }: { name: string }) => {
      const ReactActual = jest.requireActual<typeof import('react')>('react');
      const { View } = jest.requireActual<typeof import('react-native')>('react-native');
      return ReactActual.createElement(View, { testID: `icon-${name}`, ...props });
    },
  }),
  { virtual: true }
);

let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

describe('ContactRow BLE avatars', () => {
  beforeEach(() => {
    jest.mocked(ListRow).mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('props.pointerEvents is deprecated')) return;
      throw new Error(`Unexpected console.warn: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('routes BitChat peers without pictures through Avatar fallback instead of a Bluetooth icon', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <ContactRow identity={bleIdentity({ peerID: 'peer-abc', nickname: 'Nearby Alice' })} />
      );
    });

    const listRowProps = jest.mocked(ListRow).mock.calls[0]?.[0];

    expect(listRowProps?.avatar).toEqual({
      picture: undefined,
      seed: 'peer-abc',
      name: 'Nearby Alice',
      size: 44,
      state: 'fallback',
    });
    expect(listRowProps?.iconCircle).toBeUndefined();

    act(() => {
      renderer.unmount();
    });
  });
});
