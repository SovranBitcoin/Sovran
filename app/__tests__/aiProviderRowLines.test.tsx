/**
 * @jest-environment node
 *
 * What an AI provider row says, and how many lines it takes to say it.
 *
 * The row had four lines: the name, a subtitle restating the balance and the
 * encryption, the stats pills, and — when the provider could not be chosen —
 * the reason. The subtitle was the one carrying nothing the stats line did not
 * already carry, so it went; what took its place is the one thing the row was
 * missing, which is WHO RUNS THIS. A node is a machine and somebody operates
 * it, and that somebody is who the user is trusting with their prompts — so it
 * reads as an attribution under the name rather than as a labelled field on a
 * details page. The row is name / run by / stats, plus the reason when it
 * cannot be chosen.
 *
 * The operator's two stats travel together. Reputation and reach are the same
 * person's, read in the same pass, and a shield with no follower count beside
 * it left the reader guessing whether the missing pill meant nobody follows
 * them or nobody looked.
 *
 * Reachability is not on that line at all. It is a dot on the provider's own
 * face, where the eye lands first and nothing has to make room for it — the
 * word "Online" was competing for width with the balance, the sealed-model
 * count and the operator's reach, four items deep, to say the one thing that
 * decides whether any of the rest matters. `unknown` draws NOTHING: "nobody
 * has checked" is a different claim from "this is down", and a grey dot is
 * still a mark in the place a verdict goes.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ContactRow, providerIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { PresenceDot } from '@/shared/ui/primitives/PresenceDot';
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
    // Unrendered: `ListRow` is mocked and takes this as a prop, so what comes
    // back is the element tree ContactRow built rather than its output.
    leading: listRowProps?.leading,
    stats: accent?.props.stats ?? [],
    note: accent?.props.note,
  };
}

/** The first element of this type anywhere in an unrendered tree. */
function findByType<P>(
  node: unknown,
  type: (props: P) => unknown
): React.ReactElement<P> | undefined {
  if (node == null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByType(child, type);
      if (hit) return hit;
    }
    return undefined;
  }
  const element = node as React.ReactElement<{ children?: unknown }>;
  if (element.type === type) return element as unknown as React.ReactElement<P>;
  return findByType(element.props?.children, type);
}

/** Flatten a rendered subtitle node down to the words it puts on screen. */
function spoken(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(spoken).join('');
  const element = node as { props?: { children?: unknown } };
  return element.props ? spoken(element.props.children) : '';
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
    nostrIdentity('a'.repeat(64), { name: 'gudnuf', followers: 1_234, score: 62 }),
  ],
  title: 'redsh1ft',
  // Inline, as the screen mounts it: with the stats on a band of their own the
  // row is taller than the band the 44px avatar is centred in, so the face sat
  // visibly above the middle of its own row.
  onPress: () => {},
  testID: 'contact-row:provider:https://ai.redsh1ft.com',
  ...over,
});

beforeEach(() => {
  jest.mocked(ListRow).mockClear();
});

describe('AI provider row', () => {
  it('is three lines: who it is, who runs it, and what the network makes of them', () => {
    const rendered = renderProviderRow(
      row({ disabled: true, disabledReason: 'Not answering right now' })
    );
    // 1. the name (or the URL, when a provider publishes no name)
    expect(rendered.title).toBe('redsh1ft');
    // 2. the operator, as an attribution and not a labelled field
    expect(spoken(rendered.subtitle)).toBe('Run by gudnuf');
    // 3. the stats — and NOT a fourth line repeating them in prose
    expect(rendered.stats.length).toBeGreaterThan(0);
    // and the reason, once, when there is one
    expect(rendered.note).toBe('Not answering right now');
  });

  it('carries no reason line when the provider is choosable', () => {
    const rendered = renderProviderRow(row());
    expect(rendered.note).toBeUndefined();
  });

  it('says nothing about an operator a provider does not publish', () => {
    const rendered = renderProviderRow(
      row({
        identity: [providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'online' })],
      })
    );
    expect(rendered.subtitle).toBeUndefined();
  });

  it('shows reach and reputation together, or not at all', () => {
    const rendered = renderProviderRow(row());
    expect(rendered.stats.find((stat) => stat.icon === 'reputation')?.value).toBe('62');
    expect(rendered.stats.find((stat) => stat.icon === 'followers')?.value).toBe('1.2k');
  });

  it('prints a counted zero rather than dropping the pill', () => {
    const rendered = renderProviderRow(
      row({
        identity: [
          providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'online' }),
          nostrIdentity('a'.repeat(64), { name: 'gudnuf', followers: 0, score: 62 }),
        ],
      })
    );
    // Nobody follows them is a fact, and it is not the same fact as nobody
    // having looked. It used to drop out, leaving a lone shield.
    expect(rendered.stats.find((stat) => stat.icon === 'followers')?.value).toBe('0');
    expect(rendered.stats.find((stat) => stat.icon === 'reputation')?.value).toBe('62');
  });

  it('keeps the follower pill, unmeasured, when nobody resolved the count', () => {
    const rendered = renderProviderRow(
      row({
        identity: [
          providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'online' }),
          // nagg returns `null` for a reach it could not resolve — a third
          // state, and emphatically not zero.
          nostrIdentity('a'.repeat(64), { name: 'gudnuf', followers: null, score: 62 }),
        ],
      })
    );
    const followers = rendered.stats.find((stat) => stat.icon === 'followers');
    expect(followers?.value).toBe('—');
    expect(followers?.accessibilityLabel).toBe('Follower count not measured');
    expect(rendered.stats.find((stat) => stat.icon === 'reputation')?.value).toBe('62');
  });

  it('shows neither when the operator has been read and has no numbers at all', () => {
    const rendered = renderProviderRow(
      row({
        identity: [
          providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'online' }),
          nostrIdentity('a'.repeat(64), { name: 'gudnuf' }),
        ],
      })
    );
    expect(rendered.stats.some((stat) => stat.icon === 'reputation')).toBe(false);
    expect(rendered.stats.some((stat) => stat.icon === 'followers')).toBe(false);
  });

  it.each([['online'], ['offline']] as const)(
    'marks %s on the provider’s own face, and nowhere on the stats line',
    (status) => {
      const rendered = renderProviderRow(
        row({ identity: [providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status })] })
      );
      expect(rendered.stats.some((stat) => stat.icon === 'lucide:activity')).toBe(false);
      expect(findByType(rendered.leading, PresenceDot)?.props.presence).toBe(status);
    }
  );

  it('draws no dot at all for a provider nobody has checked', () => {
    const rendered = renderProviderRow(
      row({
        identity: [providerIdentity({ baseUrl: 'https://ai.redsh1ft.com', status: 'unknown' })],
      })
    );
    // `null`, not a grey dot. A mark in the place a verdict goes says one has
    // been reached, and none has.
    expect(findByType(rendered.leading, PresenceDot)?.props.presence).toBeNull();
  });

  it.each([
    ['online', 'Online'],
    ['offline', 'Offline'],
  ] as const)('says %s in words for a screen reader', (presence, label) => {
    // The colour is the entire signal for a sighted reader, so losing the
    // word from the row cannot mean losing it from the accessibility tree.
    // The sighted redundancy moved to the disabled reason, which still reads
    // "Not answering right now" under every offline row.
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PresenceDot, { presence, size: 44 }));
    });
    expect(renderer!.root.findByProps({ accessibilityLabel: label })).toBeTruthy();
    act(() => renderer.unmount());
  });

  it('renders nothing for an unchecked provider', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(PresenceDot, { presence: null, size: 44 })
      );
    });
    expect(renderer!.toJSON()).toBeNull();
    act(() => renderer.unmount());
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
