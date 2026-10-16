import type { ReactElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { MintRow } from '@/features/mint/hooks/useMintRowsWithCache';
import { MintListScreen } from '@/features/mint/screens/MintListScreen';

// eslint-disable-next-line no-restricted-syntax -- parseable theme fixture color
const mockColor = '#ffffff';

// The list hands `extraData` to `renderItem`, the way FlashList does. Rows are
// keyed by `keyExtractor`, so the key each row gets is part of what is pinned.
jest.mock('@/shared/ui/composed/List', () => ({
  List: ({
    data,
    renderItem,
    keyExtractor,
    extraData,
  }: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number; extraData: unknown }) => ReactElement;
    keyExtractor: (item: unknown) => string;
    extraData: unknown;
  }) => {
    const { Fragment, createElement } = jest.requireActual('react');
    return data.map((item, index) =>
      createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item, index, extraData }))
    );
  },
}));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: 'ContactRow',
  mintIdentity: (mint: unknown) => mint,
}));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({
  CircleActionButton: 'CircleActionButton',
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: ReactElement }) => children,
}));
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: ({
    loading,
    renderSkeleton,
    renderContent,
  }: {
    loading: boolean;
    renderSkeleton: () => ReactElement;
    renderContent: () => ReactElement;
  }) => (loading ? renderSkeleton() : renderContent()),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({ E2EToastProbe: () => null }));
jest.mock('@/features/mint/components/MintCurrencyTabs', () => ({ MINT_CURRENCY_TABS_HEIGHT: 0 }));
jest.mock('@/features/mint/hooks/useStickyCurrencyTabs', () => ({
  useStickyCurrencyTabs: () => ({
    totalHeaderHeight: 0,
    setTotalHeaderHeight: () => {},
    handleScroll: () => {},
    currencyTabs: null,
    headerSpacer: null,
  }),
}));
jest.mock('@/features/mint/hooks/useMintPresence', () => ({ useMintPresence: () => ({}) }));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useShiftLogger: () => ({ report: () => {} }),
}));
// The screen's own instrumentation is not under test; keep it off the console.
jest.mock('@/shared/lib/logger', () => {
  const actual = jest.requireActual('@/shared/lib/logger');
  return {
    ...actual,
    cashuLog: actual.createLogger({ level: 'fatal', async: false, transports: [] }),
    countRowRender: () => {},
    useLifecycleLogger: () => {},
    useQueryResultLogger: () => {},
    useStateChangeLogger: () => {},
    useWhyDidRender: () => {},
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => [mockColor, mockColor],
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) =>
    selector({ mockMode: false }),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (selector: (state: { activeUnit: string }) => unknown) =>
    selector({ activeUnit: 'sat' }),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ getMockMintBalance: () => 0 }));

const mint = (name: string, over: Partial<MintRow> = {}): MintRow => ({
  mintUrl: `https://${name}.example`,
  displayName: name,
  balance: 100,
  unit: 'sat',
  status: 'available',
  reason: null,
  isPreferred: false,
  metaState: 'live',
  ...over,
});

const ITEMS = [
  mint('alpha'),
  mint('beta', {
    status: 'disabled',
    reason: { code: 'insufficient_balance', message: 'Not enough balance' },
  }),
  mint('gamma'),
];

/** The props the screen hands each ContactRow. */
type Row = {
  props: {
    testID: string;
    identity: { mintUrl: string };
    loading?: boolean;
    disabled?: boolean;
    disabledReason?: string;
    trailing?: ReactElement<{ mintUrl: string; onPress: () => void }> | null;
    trailingInteractive?: boolean;
    trailingVariant?: string;
    onPress: () => void;
  };
};

function mount(props: Partial<Parameters<typeof MintListScreen>[0]> = {}) {
  const onMintSelect = jest.fn();
  const onInspectMint = jest.fn();
  const element = (over: Partial<Parameters<typeof MintListScreen>[0]> = {}) => (
    <MintListScreen
      items={ITEMS}
      onMintSelect={onMintSelect}
      onInspectMint={onInspectMint}
      {...props}
      {...over}
    />
  );
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element());
  });
  const rows = (): Row[] =>
    renderer.root
      .findAllByType('ContactRow' as never)
      .map((node): Row => ({ props: node.props as Row['props'] }));
  const update = (over: Partial<Parameters<typeof MintListScreen>[0]>) =>
    act(() => renderer.update(element(over)));
  return { rows, update, onMintSelect, onInspectMint };
}

describe('MintListScreen rows', () => {
  it('renders one row per mint, in order, identified by its mint url', () => {
    const { rows } = mount();
    expect(rows().map((row) => row.props.testID)).toEqual([
      'contact-row:mint:https://alpha.example',
      'contact-row:mint:https://beta.example',
      'contact-row:mint:https://gamma.example',
    ]);
    expect(rows().map((row) => row.props.identity.mintUrl)).toEqual(ITEMS.map((m) => m.mintUrl));
  });

  it('disables only unavailable mints while idle, and says why', () => {
    const { rows } = mount();
    expect(rows().map((row) => row.props.disabled)).toEqual([false, true, false]);
    expect(rows()[1]!.props.disabledReason).toBe('Not enough balance');
  });

  it('selects an available mint and ignores an unavailable one', () => {
    const { rows, onMintSelect } = mount();
    act(() => rows()[1]!.props.onPress());
    expect(onMintSelect).not.toHaveBeenCalled();
    act(() => rows()[2]!.props.onPress());
    expect(onMintSelect).toHaveBeenCalledTimes(1);
    expect(onMintSelect).toHaveBeenCalledWith(ITEMS[2]);
  });

  it('disables every row and blocks selection while a flow is executing, then recovers', () => {
    const { rows, update, onMintSelect } = mount();

    update({ isExecuting: true });
    expect(rows().map((row) => row.props.disabled)).toEqual([true, true, true]);
    act(() => rows()[0]!.props.onPress());
    expect(onMintSelect).not.toHaveBeenCalled();

    update({ isExecuting: false });
    expect(rows().map((row) => row.props.disabled)).toEqual([false, true, false]);
    act(() => rows()[0]!.props.onPress());
    expect(onMintSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('opens the pressed mint from its inspect button', () => {
    const { rows, onInspectMint } = mount();
    const trailing = rows()[2]!.props.trailing;
    expect(rows()[2]!.props.trailingInteractive).toBe(true);
    act(() => trailing!.props.onPress());
    expect(onInspectMint).toHaveBeenCalledWith('https://gamma.example');
  });

  it('shows no inspect button when details are off', () => {
    const { rows } = mount({ showDetailsButton: false });
    for (const row of rows()) {
      expect(row.props.trailing).toBeNull();
      expect(row.props.trailingInteractive).toBe(false);
      expect(row.props.trailingVariant).toBe('none');
    }
  });

  it('renders a cold row as a skeleton beside live rows', () => {
    const { rows } = mount({ items: [mint('alpha'), mint('cold', { metaState: 'cold' })] });
    expect(rows().map((row) => row.props.testID)).toEqual([
      'contact-row:mint:https://alpha.example',
      'contact-row:mint-skeleton:https://cold.example',
    ]);
    expect(rows()[1]!.props.loading).toBe(true);
  });
});
