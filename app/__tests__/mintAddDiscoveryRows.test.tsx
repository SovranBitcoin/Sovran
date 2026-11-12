/**
 * @jest-environment node
 *
 * The Add Mint list's rows (`MintAddScreen`): how a discovery row and the
 * saved mint metadata combine into what each row shows. The operator's
 * follower numbers come from the metadata store and appear when they land
 * after the list first painted; the audit pill prefers the store's reading
 * and falls back to the discovery row's own counts when the store has none.
 *
 * The real screen and metadata store run; the list is replaced by a host
 * element carrying the rows it is given.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { MintAddScreen } from '@/features/mint/screens/MintAddScreen';
import type { MintSearchRow } from '@/features/mint/lib/mintDiscoveryRows';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';
import { normalizeMintUrlKey } from '@/shared/lib/url';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

let mockResults: MintSearchRow[] = [];
jest.mock('@/features/mint/hooks/useMintSearch', () => ({
  useMintSearch: () => ({
    results: mockResults,
    loading: false,
    status: 'success',
    refresh: jest.fn(),
    availableUnits: [],
    matchCountByUnit: {},
  }),
}));
jest.mock('@/features/mint/hooks/useMintManagement', () => ({
  useMintManagement: () => ({ mints: [] }),
}));
jest.mock('@/features/mint/hooks/useMintProfiles', () => ({ useMintProfiles: jest.fn() }));
jest.mock('@/features/mint/hooks/useMintPresence', () => ({ useMintPresence: () => ({}) }));
jest.mock('@/features/mint/hooks/useMintImport', () => ({
  useMintImport: () => ({ state: null, start: jest.fn() }),
}));
jest.mock('@/features/mint/hooks/useDebouncedMintValidation', () => ({
  useDebouncedMintValidation: () => ({
    url: '',
    setUrl: jest.fn(),
    validationState: { isLoading: false, isValid: null },
    mintInfo: null,
  }),
}));
jest.mock('@/shared/hooks/useHeaderSearch', () => ({
  useHeaderSearch: () => ({
    isSearching: false,
    searchQuery: '',
    clearKey: 0,
    onOpenSearch: jest.fn(),
    onCloseSearch: jest.fn(),
    onSearchChange: jest.fn(),
  }),
}));
jest.mock('@/features/mint/hooks/useStickyCurrencyTabs', () => ({
  useStickyCurrencyTabs: () => ({
    setTotalHeaderHeight: jest.fn(),
    handleScroll: jest.fn(),
    currencyTabs: null,
    headerSpacer: null,
  }),
}));
jest.mock('@/features/mint/components/MintCurrencyTabs', () => ({ MINT_CURRENCY_TABS_HEIGHT: 40 }));
jest.mock('expo-router', () => ({
  Stack: { Screen: mockHost('StackScreen') },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('@/navigation/headerItems', () => ({ withGlassHeaderItems: (o: unknown) => o }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'c' : token.map(() => 'c'),
}));
jest.mock('@/shared/ui/composed/List', () => ({ List: mockHost('ListProbe') }));
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: mockHost('Screen') }));
jest.mock('@/shared/ui/composed/EmptyState', () => ({ EmptyState: mockHost('EmptyState') }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: mockHost('BottomButtons'),
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({
  ButtonHandler: mockHost('ButtonHandler'),
}));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: mockHost('ContactRow'),
  mintIdentity: () => ({}),
}));
jest.mock('@/shared/ui/composed/TierBadge', () => ({ TierBadge: mockHost('TierBadge') }));
jest.mock('@/shared/ui/composed/GlassSearchBar', () => ({
  GlassSearchBar: mockHost('GlassSearchBar'),
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: mockHost('ScreenHeaderAction'),
}));
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: mockHost('LoadingIndicator') }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: mockHost('Button') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: mockHost('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: mockHost('Spacer') }));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => {
  const log: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  log.child = () => log;
  const named: Record<string, unknown> = {
    redactError: (e: unknown) => e,
    useLifecycleLogger: jest.fn(),
    mintUrlLogFields: () => ({}),
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});

const URL = 'https://mint.example';
function row(over: Partial<MintSearchRow> = {}): MintSearchRow {
  const value: MintSearchRow = {
    url: URL,
    name: 'Example',
    supported_units: ['sat'],
    supported_methods: ['bolt11'],
    supported_method_units: [{ method: 'bolt11', unit: 'sat' }],
    state: 'unknown',
    n_mints: 9,
    n_melts: 1,
    n_errors: 0,
    review_score: 4,
    review_count: 3,
    info: { icon_url: 'https://mint.example/icon.png', contact: [] },
  };
  return { ...value, ...over };
}
const seedMetadata = (entry: MintMetadataEntry | null) =>
  act(() => {
    useMintMetadataStore.setState({
      byMintUrl: entry ? { [normalizeMintUrlKey(URL)]: entry } : {},
    });
  });

let renderer: TestRenderer.ReactTestRenderer;
async function render() {
  await act(async () => {
    renderer = TestRenderer.create(<MintAddScreen />);
  });
}
const shownRows = () =>
  renderer.root.findByType('ListProbe' as never).props.data as Record<string, unknown>[];

beforeEach(() => {
  mockResults = [row()];
  seedMetadata(null);
});
afterEach(() => {
  act(() => renderer?.unmount());
});

describe('Add Mint rows', () => {
  it('shows the discovery row before any metadata, with the audit from its own counts', async () => {
    await render();

    expect(shownRows()).toEqual([
      {
        url: URL,
        name: 'Example',
        mintInfo: {
          icon_url: 'https://mint.example/icon.png',
          name: 'Example',
          description: null,
          contact: [],
        },
        contactFollowers: undefined,
        contactReputation: undefined,
        audit: expect.objectContaining({ totalOps: 10 }),
        reviewScore: 4,
        reviewCount: 3,
      },
    ]);
  });

  it('picks up the operator numbers when they land after the first paint, reputation rounded', async () => {
    await render();
    seedMetadata({ contactFollowers: 120, contactReputation: 7.6 });

    expect(shownRows()[0]).toMatchObject({ contactFollowers: 120, contactReputation: 8 });
  });

  it('prefers the saved audit reading over the discovery counts', async () => {
    seedMetadata({ auditState: 'ok', nMints: 40, nMelts: 10, nErrors: 0 });
    await render();

    expect(shownRows()[0]!.audit).toEqual(expect.objectContaining({ totalOps: 50 }));
  });

  it('names a row by its url domain when discovery gives no name', async () => {
    mockResults = [row({ name: '', info: {} })];
    await render();

    expect(shownRows()[0]).toMatchObject({
      name: 'mint.example',
      mintInfo: { icon_url: null, name: '', description: null, contact: undefined },
    });
  });
});
