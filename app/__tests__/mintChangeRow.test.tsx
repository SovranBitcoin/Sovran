/**
 * @jest-environment node
 *
 * Notifications → Mints row copy. The row says one sentence and one count, and
 * nothing else — no host, no NUT numbers, no diff. Pin that, because "less
 * verbose" is the whole point of this surface.
 */

import TestRenderer, { act } from 'react-test-renderer';

import { MintChangeRow } from '@/features/mint/components/mintChanges/MintChangeRow';
import { decodeFeed, type RawChange } from '@/features/mint/lib/mintChanges/decode';
import {
  buildMintChangeListItems,
  flattenMintChangeUpdates,
} from '@/features/mint/lib/mintChanges/groupEntries';

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
  formatRelative: jest.fn(() => '2d'),
}));

jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useCachedMintMetadata: jest.fn(() => ({ iconUrl: undefined })),
}));

jest.mock('@/shared/ui/composed/MintIcon', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MintIcon: () => ReactActual.createElement(View, { testID: 'mint-icon' }) };
});

jest.mock('@/assets/icons', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => ReactActual.createElement(View, { testID: name }),
  };
});

const updates = (changes: RawChange[]) =>
  flattenMintChangeUpdates(
    buildMintChangeListItems(
      decodeFeed({
        trackedMints: 1,
        reachableMints: 1,
        totalChanges: changes.length,
        changes,
      }).entries
    )
  );

/** Renders the row for one update — index 0 is the highest-ranked one. */
function renderRow(changes: RawChange[], index = 0) {
  const all = updates(changes);
  const update = all[index]!;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MintChangeRow update={update} onPress={jest.fn()} />);
  });
  const texts: string[] = [];
  tree.root
    .findAll((node) => typeof node.type === 'string')
    .forEach((node) => {
      node.children.forEach((child) => {
        if (typeof child === 'string') texts.push(child);
      });
    });
  const glyphs = tree.root
    .findAll((node) => typeof node.type !== 'string' && !!(node.props as { name?: string }).name)
    .map((node) => (node.props as { name: string }).name);
  const result = { update, updates: all, text: texts.join(' '), glyphs };
  act(() => tree.unmount());
  return result;
}

const versionBump: RawChange = {
  mintUrl: 'https://mint.sovran.money',
  name: 'Sovran',
  at: 1785074264,
  previousLastSeenAt: 1784762841,
  hash: 'h1',
  patch: [
    { op: 'add', path: '/nuts/29', value: { max_batch_size: 1000, methods: ['bolt11'] } },
    { op: 'test', path: '/version', value: 'Nutshell/0.20.0' },
    { op: 'replace', path: '/version', value: 'Nutshell/0.20.3' },
  ],
};

describe('MintChangeRow', () => {
  it('says one sentence about the mint, and a timestamp', () => {
    const { text } = renderRow([versionBump]);
    expect(text).toContain('Sovran added batched deposits');
    expect(text).toContain('2d');
  });

  it('says none of the protocol detail the sentence stands in for', () => {
    const { text } = renderRow([versionBump]);
    expect(text).not.toContain('NUT');
    expect(text).not.toContain('mint.sovran.money');
    expect(text).not.toContain('0.20.3');
    expect(text).not.toContain('method');
  });

  it('wears the glyph for its kind of change', () => {
    // Capability first (ranked above software), then the version bump.
    expect(renderRow([versionBump]).glyphs).toContain('mdi:star-four-points');
    expect(renderRow([versionBump], 1).glyphs).toContain('mdi:package-up');
  });

  it('carries the rail its own glyph', () => {
    const { glyphs, text } = renderRow([
      {
        ...versionBump,
        patch: [
          { op: 'add', path: '/nuts/4/methods/-', value: { method: 'onchain', unit: 'sat' } },
          { op: 'add', path: '/nuts/5/methods/-', value: { method: 'onchain', unit: 'sat' } },
        ],
      },
    ]);
    expect(text).toContain('Sovran added Onchain sending & receiving');
    expect(glyphs).toContain('mdi:bitcoin');
  });

  it('gives every update in a revision its own row', () => {
    const { updates: all } = renderRow([versionBump]);
    expect(all.map((update) => update.phrase.text)).toEqual([
      'added batched deposits',
      'updated its software',
    ]);
    expect(all.every((update) => update.at === versionBump.at)).toBe(true);
  });
});
