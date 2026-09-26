/**
 * @jest-environment node
 *
 * ContactRow reads the operator's reputation and reach from the single owner
 * (the entity cache's profile stats) when the identity it was handed carries
 * neither. A score fetched by a search, a discovery pass, the provider
 * directory or an earlier profile open must show on every later row for the
 * same person — the "dash everywhere" report was each surface only knowing
 * what its own endpoint had said.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ContactRow, mintIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { ListRow } from '@/shared/ui/composed/ListRow';
import type { RowStat } from '@/shared/ui/composed/RowStatsAccent';

let mockCachedStats: { score?: number; followersCount?: number } | undefined;
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useCachedProfileStats: (pubkey: string | undefined) =>
    pubkey === 'operator-pubkey' ? mockCachedStats : undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : 'theme-single',
}));

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn(() => 'rgba(0,0,0,0.12)'),
}));

jest.mock('@/shared/lib/date', () => ({
  formatRelative: jest.fn(() => 'recently'),
}));

jest.mock('@/shared/stores/global/settingsStore', () => {
  const state = {
    language: 'en',
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

jest.mock('@/shared/ui/composed/MintIcon', () => ({
  MintIcon: () => null,
}));

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

// Identifiable stand-ins so we can assert which selection/accent node ContactRow
// hands to ListRow without rendering their internals.
jest.mock('@/shared/ui/primitives/SelectableCheck', () => ({
  SelectableCheck: function SelectableCheck() {
    return null;
  },
}));

jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AmountFormatter: () => null,
}));

jest.mock('@/shared/ui/composed/RowStatsAccent', () => ({
  RowStatsAccent: function RowStatsAccent() {
    return null;
  },
  RowStatsAccentSkeleton: function RowStatsAccentSkeleton() {
    return null;
  },
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

function renderStats(element: React.ReactElement): RowStat[] | undefined {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  const listRowProps = jest.mocked(ListRow).mock.calls[0]?.[0] as
    { accent?: React.ReactElement<{ stats?: RowStat[] }> } | undefined;
  act(() => {
    renderer.unmount();
  });
  return listRowProps?.accent?.props.stats;
}

const byIcon = (stats: RowStat[] | undefined, icon: string) =>
  stats?.find((stat) => stat.icon === icon)?.value;

describe('ContactRow cached reputation', () => {
  beforeEach(() => {
    jest.mocked(ListRow).mockClear();
    mockCachedStats = undefined;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('fills reputation and followers from the cache when the identity has neither', () => {
    mockCachedStats = { score: 77, followersCount: 1234 };
    const stats = renderStats(
      <ContactRow
        identity={nostrIdentity('operator-pubkey', { name: 'Op' })}
        stats={['reputation', 'followers']}
      />
    );
    expect(byIcon(stats, 'reputation')).toBe('77');
    expect(byIcon(stats, 'followers')).toBe('1.2k');
  });

  it('the identity’s own figure wins, and the cache fills only the missing half', () => {
    mockCachedStats = { score: 77, followersCount: 1234 };
    const stats = renderStats(
      <ContactRow
        identity={nostrIdentity('operator-pubkey', { name: 'Op', followers: 10 })}
        stats={['reputation', 'followers']}
      />
    );
    expect(byIcon(stats, 'reputation')).toBe('77');
    expect(byIcon(stats, 'followers')).toBe('10');
  });

  it('a mint row whose operator the cache knows shows the operator figures', () => {
    mockCachedStats = { score: 61 };
    const stats = renderStats(
      <ContactRow
        identity={[
          mintIdentity({ mintUrl: 'https://mint.example', displayName: 'Mint' }),
          nostrIdentity('operator-pubkey', { name: 'Op' }),
        ]}
        stats={['reputation', 'followers']}
      />
    );
    expect(byIcon(stats, 'reputation')).toBe('61');
    // Nobody counted reach: a dash beside its own icon, never 0.
    expect(byIcon(stats, 'followers')).toBe('—');
  });

  it('with nothing cached and nothing on the identity, the pair stays hidden', () => {
    const stats = renderStats(
      <ContactRow
        identity={nostrIdentity('operator-pubkey', { name: 'Op' })}
        stats={['reputation', 'followers']}
      />
    );
    expect(stats ?? []).toEqual([]);
  });
});
