/**
 * @jest-environment node
 *
 * The swap detail screen (`SwapTransactionScreen`): the header amount, the
 * Status / Steps / Total Fees / Date rows and the per-leg rows it shows for a
 * swap group, read from the saved swap group and the wallet history matched by
 * quote id. Pinned with several legs, a chain that supersedes a direct leg, a
 * failed leg, a non-sat unit and a group whose history has not loaded.
 *
 * The real screen, swap store and settings store run. Leaf UI (amount text,
 * the details list, the transfer rows, the shell) is replaced by host
 * elements that carry their props, so the test reads what each is given.
 * `formatAmount` is replaced by a recorder so the currency each figure is
 * converted to is visible.
 */
import type { HistoryEntry } from '@cashu/coco-core';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SwapTransactionScreen } from '@/features/transactions/screens/SwapTransactionScreen';
import {
  useSwapTransactionsStore,
  type SwapGroup,
  type SwapLeg,
} from '@/shared/stores/profile/swapTransactionsStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

let mockHistory: HistoryEntry[] = [];
jest.mock('@/features/transactions', () => ({
  useHistoryWithMelts: () => ({ history: mockHistory }),
}));
jest.mock('@/features/transactions/hooks/useSwapMintInfo', () => ({
  useSwapMintInfo: () => ({}),
}));
jest.mock('@/features/transactions/components/detail/TransactionDetailShell', () => ({
  TransactionDetailShell: mockHost('TransactionDetailShell'),
}));
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: mockHost('Screen') }));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AmountFormatter: mockHost('AmountFormatter'),
}));
jest.mock('@/shared/ui/composed/DetailsList', () => ({ DetailsList: mockHost('DetailsList') }));
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: mockHost('MintIcon') }));
jest.mock('@/shared/blocks/transfer', () => ({
  TransferEntryRow: mockHost('TransferEntryRow'),
  TransferSeparator: mockHost('TransferSeparator'),
  TransferCard: mockHost('TransferCard'),
  TransferErrorBanner: mockHost('TransferErrorBanner'),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: mockHost('Text'),
  UntranslatedText: mockHost('UntranslatedText'),
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: mockHost('VStack') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: mockHost('HStack') }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: mockHost('Spacer') }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: mockHost('Pressable') }));
jest.mock('assets/icons', () => mockHost('Icon'));
jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const View = (props: Record<string, unknown>) =>
    R.createElement('Animated.View', props, props.children as React.ReactNode);
  return {
    __esModule: true,
    default: { View },
    Easing: { bezier: () => 'bezier' },
    LinearTransition: { duration: () => 'layout' },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (worklet: () => Record<string, unknown>) => worklet(),
    withTiming: (target: number) => target,
  };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? token : [...token],
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (c: string) => c,
}));
jest.mock('@/shared/lib/currency', () => ({
  formatAmount: (
    input: { amount: number; unit: string },
    options: { displayAs?: string; currencyDisplay?: string }
  ) =>
    `${input.amount} ${input.unit} as ${options.displayAs}${
      options.currencyDisplay ? `/${options.currencyDisplay}` : ''
    }`,
}));
const mockNavigateToDetail = jest.fn();
jest.mock('@/shared/lib/nav/transactionDetailRoutes', () => ({
  navigateToTransactionDetail: (...args: unknown[]) => mockNavigateToDetail(...args),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const named: Record<string, unknown> = {
    redactError: (e: unknown) => e,
    useLifecycleLogger: jest.fn(),
  };
  // Every other export is a domain logger (log, storeLog, cashuLog, ...).
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';
const CREATED = Date.UTC(2026, 10, 1, 12);

function historyEntry(
  type: 'mint' | 'melt',
  quoteId: string,
  amount: number,
  unit = 'sat'
): HistoryEntry {
  const entry = {
    id: `${type}-${quoteId}`,
    type,
    quoteId,
    amount,
    unit,
    mintUrl: type === 'melt' ? A : B,
    createdAt: CREATED,
    state: type === 'melt' ? 'PAID' : 'ISSUED',
  };
  return entry as unknown as HistoryEntry;
}

function leg(id: string, over: Partial<SwapLeg>): SwapLeg {
  return { id, fromMintUrl: A, toMintUrl: B, amount: 0, localStatus: 'done', ...over };
}

function seedGroup(over: Partial<SwapGroup> & { legs: SwapLeg[] }) {
  const group: SwapGroup = {
    id: 'g1',
    unit: 'sat',
    createdAt: CREATED,
    title: 'Balance split',
    state: 'finished',
    ...over,
  };
  useSwapTransactionsStore.setState({ groups: { [group.id]: group }, quoteIdToGroup: {} });
  return group;
}

let renderer: TestRenderer.ReactTestRenderer;
async function render(groupId: string | undefined = 'g1') {
  await act(async () => {
    renderer = TestRenderer.create(<SwapTransactionScreen groupId={groupId} />);
  });
  return renderer;
}

const header = () => renderer.root.findByType('AmountFormatter' as never).props;
function details(): Record<string, string> {
  const items = renderer.root.findByType('DetailsList' as never).props.items as {
    title: string;
    value: string;
  }[];
  return Object.fromEntries(items.map((item) => [item.title, item.value]));
}
function fiatLine(): string {
  const texts = renderer.root.findAllByType('Text' as never);
  const inner = texts.find((t) => typeof t.props.children === 'string');
  return inner!.props.children as string;
}
async function expand() {
  await act(async () => {
    renderer.root.findByProps({ testID: 'swap-legs-toggle' }).props.onPress();
  });
}
const rows = () =>
  renderer.root.findAllByType('TransferEntryRow' as never).map((r) => r.props) as {
    testID: string;
    amount: number;
    unit: string;
    secondarySubtitle: string;
    onPress: () => void;
  }[];

beforeEach(() => {
  mockHistory = [];
  mockNavigateToDetail.mockReset();
  useSettingsStore.setState({ mockMode: false });
});

afterEach(() => {
  act(() => renderer?.unmount());
});

describe('totals for a finished multi-leg swap', () => {
  beforeEach(() => {
    seedGroup({
      legs: [
        leg('l1', { amount: 1000, meltQuoteId: 'melt1', mintQuoteId: 'mint1' }),
        leg('l2', { amount: 500, meltQuoteId: 'melt2', mintQuoteId: 'mint2', toMintUrl: C }),
      ],
    });
    mockHistory = [
      historyEntry('melt', 'melt1', -1010),
      historyEntry('mint', 'mint1', 1000),
      historyEntry('melt', 'melt2', -505),
      historyEntry('mint', 'mint2', 500),
    ];
  });

  it('shows the amount received in the header and the melt-minus-mint difference as the fee', async () => {
    await render();

    expect(header()).toMatchObject({ amount: 1500, unit: 'sat' });
    expect(fiatLine()).toBe('1500 sat as usd/symbol');
    expect(details()).toEqual({
      Status: 'Complete',
      Steps: '2',
      'Total Fees': '15 sat',
      Date: expect.any(String),
    });
  });

  it('expanded, lists each leg as a melt row then a mint row, priced in USD, opening that entry on press', async () => {
    useSettingsStore.setState({ displayCurrency: 'eur' });
    await render();
    await expand();

    expect(rows().map((r) => [r.testID, r.amount, r.secondarySubtitle])).toEqual([
      // QUIRK: the secondary line is always USD whatever the display currency.
      ['swap-leg-melt-melt-melt1', -1010, '1010 sat as usd'],
      ['swap-leg-mint-mint-mint1', 1000, '1000 sat as usd'],
      ['swap-leg-melt-melt-melt2', -505, '505 sat as usd'],
      ['swap-leg-mint-mint-mint2', 500, '500 sat as usd'],
    ]);
    rows()[1]!.onPress();
    expect(mockNavigateToDetail).toHaveBeenCalledWith(mockHistory[1], 'swap.transaction.row');
  });
});

describe('before the wallet history has loaded', () => {
  it('shows the legs’ own amounts as sent in the header and hides the fee row', async () => {
    seedGroup({
      legs: [
        leg('l1', { amount: 1000, meltQuoteId: 'melt1', mintQuoteId: 'mint1' }),
        leg('l2', { amount: 500, meltQuoteId: 'melt2', mintQuoteId: 'mint2' }),
      ],
    });

    await render();

    expect(header()).toMatchObject({ amount: 1500 });
    expect(details()).not.toHaveProperty('Total Fees');
  });

  it('expanded, shows a stand-in melt row built from the leg, and no mint row', async () => {
    seedGroup({
      legs: [
        leg('l1', {
          amount: 1000,
          meltQuoteId: 'melt1',
          meltOperationId: 'op-1',
          mintQuoteId: 'mint1',
        }),
      ],
    });

    await render();
    await expand();

    expect(rows().map((r) => [r.testID, r.amount])).toEqual([['swap-leg-melt-op-1', 1000]]);
  });

  it('with only the melt loaded, shows what was melted as sent, no fee, and the real melt row', async () => {
    seedGroup({ legs: [leg('l1', { amount: 1000, meltQuoteId: 'melt1', mintQuoteId: 'mint1' })] });
    mockHistory = [historyEntry('melt', 'melt1', -1010)];

    await render();

    expect(header()).toMatchObject({ amount: 1010 });
    expect(details()).not.toHaveProperty('Total Fees');
    await expand();
    expect(rows().map((r) => [r.testID, r.amount])).toEqual([['swap-leg-melt-melt-melt1', -1010]]);
  });

  it('with only the mint loaded, counts the leg amount as spent and draws a stand-in melt above the mint', async () => {
    seedGroup({
      legs: [
        leg('l1', {
          amount: 1000,
          meltQuoteId: 'melt1',
          meltOperationId: 'op-1',
          mintQuoteId: 'mint1',
        }),
      ],
    });
    mockHistory = [historyEntry('mint', 'mint1', 990)];

    await render();

    expect(header()).toMatchObject({ amount: 990 });
    expect(details()).toMatchObject({ 'Total Fees': '10 sat' });
    await expand();
    expect(rows().map((r) => [r.testID, r.amount])).toEqual([
      ['swap-leg-melt-op-1', 1000],
      ['swap-leg-mint-mint-mint1', 990],
    ]);
  });

  it('when two history entries share a quote id, the later one in history is used', async () => {
    seedGroup({ legs: [leg('l1', { amount: 1000, mintQuoteId: 'mint1' })] });
    mockHistory = [
      historyEntry('mint', 'mint1', 700),
      { ...historyEntry('mint', 'mint1', 990), id: 'mint-again' } as unknown as HistoryEntry,
    ];

    await render();

    expect(header()).toMatchObject({ amount: 990 });
    await expand();
    expect(rows().map((r) => [r.testID, r.amount])).toEqual([['swap-leg-mint-mint-again', 990]]);
  });
});

describe('a swap with a failed leg', () => {
  it('leaves a failed leg that never melted out of the fee', async () => {
    seedGroup({
      state: 'cancelled',
      legs: [
        leg('l1', { amount: 1000, meltQuoteId: 'melt1', mintQuoteId: 'mint1' }),
        leg('l2', {
          amount: 500,
          localStatus: 'failed',
          errorMessage: 'Destination unreachable',
        }),
      ],
    });
    mockHistory = [historyEntry('melt', 'melt1', -1000), historyEntry('mint', 'mint1', 990)];

    await render();

    // The failed leg never melted: only the 10 the first leg cost is a fee.
    expect(details()).toMatchObject({ Status: 'Failed', Steps: '2', 'Total Fees': '10 sat' });
    expect(header()).toMatchObject({ color: 'danger' });
    expect(header()).toMatchObject({ amount: 990 });

    await expand();
    const banners = renderer.root.findAllByType('TransferErrorBanner' as never);
    expect(banners.map((b) => b.props.message)).toEqual(['Destination unreachable']);
  });

  it('keeps counting a failed leg whose mint arrived, though its melt is not loaded', async () => {
    seedGroup({
      state: 'cancelled',
      legs: [
        leg('l1', { amount: 1000, meltQuoteId: 'melt1', mintQuoteId: 'mint1' }),
        leg('l2', { amount: 500, mintQuoteId: 'mint2', localStatus: 'failed' }),
      ],
    });
    mockHistory = [
      historyEntry('melt', 'melt1', -1000),
      historyEntry('mint', 'mint1', 990),
      historyEntry('mint', 'mint2', 490),
    ];

    await render();

    // Money arrived for the failed leg, so it was sent: 1500 out, 1480 in.
    expect(details()).toMatchObject({ 'Total Fees': '20 sat' });
  });

  it('a finished group with a failed leg reads Failed, as its history row does', async () => {
    seedGroup({
      legs: [
        leg('l1', { amount: 1000, meltQuoteId: 'melt1', mintQuoteId: 'mint1' }),
        leg('l2', { amount: 500, localStatus: 'failed' }),
      ],
    });
    mockHistory = [historyEntry('melt', 'melt1', -1000), historyEntry('mint', 'mint1', 990)];

    await render();

    expect(details()).toMatchObject({ Status: 'Failed', 'Total Fees': '10 sat' });
    expect(header()).toMatchObject({ color: 'danger' });
  });

  it('a failed leg beside one still settling reads Running, as its history row does', async () => {
    seedGroup({
      legs: [
        leg('l1', { amount: 500, localStatus: 'failed' }),
        leg('l2', { amount: 700, localStatus: 'settling', meltQuoteId: 'melt2' }),
      ],
    });
    mockHistory = [historyEntry('melt', 'melt2', -710)];

    await render();

    expect(details()).toMatchObject({ Status: 'Running' });
    expect(details()).not.toHaveProperty('Total Fees');
  });

  it('a group still saved as running reads Running', async () => {
    seedGroup({ state: 'running', legs: [leg('l1', { amount: 700, localStatus: 'melting' })] });

    await render();

    expect(details()).toMatchObject({ Status: 'Running' });
  });

  it.each([
    ['cancelled', 'melting'],
    ['cancelled', 'verifying'],
    ['finished', 'melting'],
    ['finished', 'invoiceReady'],
  ] as const)(
    'a %s group with a leg still %s reads Running and shows no fee',
    async (state, localStatus) => {
      seedGroup({
        state,
        legs: [
          leg('l1', { amount: 700, localStatus, meltQuoteId: 'melt1', meltOperationId: 'op-1' }),
        ],
      });
      mockHistory = [historyEntry('melt', 'melt1', -710)];

      await render();

      // The melt may still be paid: nothing is lost to fees yet, and nothing is over.
      expect(details()).toMatchObject({ Status: 'Running' });
      expect(details()).not.toHaveProperty('Total Fees');
    }
  );

  it('a cancelled group with no history shows no fee', async () => {
    seedGroup({
      state: 'cancelled',
      legs: [leg('l1', { amount: 700, localStatus: 'failed' })],
    });

    await render();

    // Nothing was sent, so nothing was lost to fees; the header keeps the amount asked for.
    expect(details()).toMatchObject({ Status: 'Failed' });
    expect(details()).not.toHaveProperty('Total Fees');
    expect(header()).toMatchObject({ amount: 700 });
  });
});

describe('a chain that replaces a direct leg', () => {
  it('hides the failed direct leg on the same route and counts only the chain legs', async () => {
    seedGroup({
      legs: [
        leg('direct', { fromMintUrl: A, toMintUrl: C, amount: 800, localStatus: 'failed' }),
        leg('hop1', {
          fromMintUrl: A,
          toMintUrl: B,
          amount: 800,
          chainId: 'ch1',
          chainPath: [A, B, C],
          chainHopIndex: 0,
          meltQuoteId: 'melt1',
          mintQuoteId: 'mint1',
        }),
        leg('hop2', {
          fromMintUrl: B,
          toMintUrl: C,
          amount: 790,
          chainId: 'ch1',
          chainPath: [A, B, C],
          chainHopIndex: 1,
          meltQuoteId: 'melt2',
          mintQuoteId: 'mint2',
        }),
      ],
    });
    mockHistory = [
      historyEntry('melt', 'melt1', -800),
      historyEntry('mint', 'mint1', 790),
      historyEntry('melt', 'melt2', -790),
      historyEntry('mint', 'mint2', 780),
    ];

    await render();

    // The transfer arrived by the chain, so the swap is complete, as its history row says.
    expect(details()).toMatchObject({ Status: 'Complete', Steps: '2', 'Total Fees': '20 sat' });
    expect(header()).toMatchObject({ amount: 1570, color: 'success' });
    expect(renderer.root.findAllByType('TransferCard' as never)).toHaveLength(1);
  });

  it('expanded, gives a chain split by a standalone leg two cards, in saved order', async () => {
    const hop = (id: string) =>
      leg(id, { amount: 100, chainId: 'ch1', chainPath: [A, B, C], meltQuoteId: `melt-${id}` });
    seedGroup({
      legs: [hop('hop1'), leg('solo', { amount: 100, meltQuoteId: 'melt-solo' }), hop('hop2')],
    });

    await render();
    await expand();

    const cards = renderer.root
      .findAllByType('TransferCard' as never)
      .map((card) =>
        card.findAllByType('TransferEntryRow' as never).map((r) => r.props.testID as string)
      );
    expect(cards).toEqual([['swap-leg-melt-hop1'], ['swap-leg-melt-solo'], ['swap-leg-melt-hop2']]);
    expect(details()).toMatchObject({ Steps: '3' });
  });
});

describe('a swap in a unit other than sat', () => {
  it('shows the amounts in that unit and the fiat line in sats by name', async () => {
    seedGroup({
      unit: 'usd',
      legs: [leg('l1', { amount: 250, meltQuoteId: 'melt1', mintQuoteId: 'mint1' })],
    });
    mockHistory = [
      historyEntry('melt', 'melt1', -260, 'usd'),
      historyEntry('mint', 'mint1', 250, 'usd'),
    ];

    await render();

    expect(header()).toMatchObject({ amount: 250, unit: 'usd' });
    expect(fiatLine()).toBe('250 usd as sats/name');
    expect(details()).toMatchObject({ 'Total Fees': '10 usd' });
    await expand();
    expect(rows().map((r) => [r.unit, r.secondarySubtitle])).toEqual([
      ['usd', '260 usd as usd'],
      ['usd', '250 usd as usd'],
    ]);
  });
});

describe('an unknown group', () => {
  it('shows the not-found screen and no details', async () => {
    useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} });

    await render('missing');

    expect(renderer.root.findAllByType('DetailsList' as never)).toHaveLength(0);
    expect(renderer.root.findByType('Screen' as never).props.name).toBe('SwapTransactionScreen');
  });
});
