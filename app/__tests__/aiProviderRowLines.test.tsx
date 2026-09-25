/**
 * @jest-environment node
 *
 * What an AI provider row says, and how many lines it takes to say it.
 *
 * The row had four lines: the name, a subtitle restating the balance and the
 * encryption, the stats pills, and — when the provider could not be chosen —
 * the reason. The subtitle was the one carrying nothing the stats line did not
 * already carry, so it is gone and the row is name / stats / reason.
 *
 * The status pill is the other half. It used to be a bare heartbeat glyph
 * whose only content was its colour, which is unreadable to a screen reader
 * and to anyone who cannot separate red from green. It now says the word — and
 * says nothing at all for `unknown`, which means "not checked yet" and must
 * never be dressed up as "Offline".
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ContactRow, providerIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { ListRow } from '@/shared/ui/composed/ListRow';
import type { RowStat } from '@/shared/ui/composed/RowStatsAccent';

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

type AccentProps = { stats: RowStat[]; note?: string };

function renderProviderRow(props: Parameters<typeof ContactRow>[0]) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(ContactRow, props));
  });
  const listRowProps = jest.mocked(ListRow).mock.calls[0]?.[0];
  act(() => {
    renderer.unmount();
  });
  const accent = listRowProps?.accent as React.ReactElement<AccentProps> | undefined;
  return {
    title: listRowProps?.title,
    subtitle: listRowProps?.subtitle,
    stats: accent?.props.stats ?? [],
    note: accent?.props.note,
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  identity: [
    providerIdentity({
      baseUrl: 'https://ai.redsh1ft.com',
      displayName: 'redsh1ft',
      spendableSats: 1_200,
      encryptedModelCount: 9,
      status: 'online' as const,
    }),
    nostrIdentity('a'.repeat(64), { followers: 1_234 }),
  ],
  title: 'redsh1ft',
  subtitle: null,
  accentPosition: 'below' as const,
  onPress: () => {},
  testID: 'contact-row:provider:https://ai.redsh1ft.com',
  ...over,
});

beforeEach(() => {
  jest.mocked(ListRow).mockClear();
});

describe('AI provider row', () => {
  it('is three lines: who it is, the stats, and why it cannot be chosen', () => {
    const rendered = renderProviderRow(
      row({ disabled: true, disabledReason: 'Not answering right now' })
    );
    // 1. the name (or the URL, when a provider publishes no name)
    expect(rendered.title).toBe('redsh1ft');
    // 2. the stats — and NOT a second line repeating them in prose
    expect(rendered.subtitle).toBeUndefined();
    expect(rendered.stats.length).toBeGreaterThan(0);
    // 3. the reason, once
    expect(rendered.note).toBe('Not answering right now');
  });

  it('drops to two lines when the provider is choosable', () => {
    const rendered = renderProviderRow(row());
    expect(rendered.subtitle).toBeUndefined();
    expect(rendered.note).toBeUndefined();
  });

  it.each([
    ['online', 'Online', 'Provider online'],
    ['offline', 'Offline', 'Provider offline'],
  ])('names the %s status in words beside the heartbeat', (status, word, label) => {
    const rendered = renderProviderRow(
      row({
        identity: [
          providerIdentity({
            baseUrl: 'https://ai.redsh1ft.com',
            status: status as 'online' | 'offline',
          }),
        ],
      })
    );
    const heartbeat = rendered.stats.find((stat) => stat.icon === 'lucide:activity');
    expect(heartbeat?.value).toBe(word);
    // Reachable by a screen reader, not conveyed by the tint alone.
    expect(heartbeat?.accessibilityLabel).toBe(label);
  });

  it('says neither Online nor Offline for a provider nobody has checked', () => {
    const rendered = renderProviderRow(
      row({
        identity: [providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'unknown' })],
      })
    );
    const heartbeat = rendered.stats.find((stat) => stat.icon === 'lucide:activity');
    expect(heartbeat).toBeDefined();
    expect(heartbeat?.value).toBe('');
    expect(heartbeat?.accessibilityLabel).toBe('Provider status not checked yet');
  });

  it('states how many models are encrypted instead of badging the provider', () => {
    const rendered = renderProviderRow(row());
    const sealed = rendered.stats.find((stat) => stat.icon === 'mdi:shield-check');
    // 9 of 582 models on this node are actually sealed, so "E2EE" as a
    // property of the provider would overstate 573 of them.
    expect(sealed?.value).toBe('9');
    expect(sealed?.accessibilityLabel).toBe('9 end-to-end encrypted models available');
  });

  it('shows no encryption pill when nobody has counted', () => {
    const rendered = renderProviderRow(
      row({
        identity: [providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'online' })],
      })
    );
    expect(rendered.stats.some((stat) => stat.icon === 'mdi:shield-check')).toBe(false);
  });
});
