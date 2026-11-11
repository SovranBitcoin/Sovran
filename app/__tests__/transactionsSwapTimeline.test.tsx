/**
 * @jest-environment node
 *
 * The history list (`Transactions`): how saved swap groups are put into the
 * list beside wallet history, which legs they hide, which status and date
 * section each row lands in, the order rows and sections come in, and what a
 * group whose legs are missing from history (or a leg whose group is missing)
 * does. Pinned for the virtualized history screen, the wallet home
 * (`showMore`) and the embedded per-person list.
 *
 * The real list, swap store and settings store run, with the real wallet
 * filters and buckets. Rows are replaced by host elements (`TxRow`,
 * `SwapRow`) and FlashList by one that renders every section, so the test
 * reads which rows sit under which heading.
 */
import type { HistoryEntry } from '@cashu/coco-core';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Transactions } from '@/features/transactions/components/Transactions';
import { formatDate } from '@/shared/lib/date';
import {
  useSwapTransactionsStore,
  type SwapGroup,
} from '@/shared/stores/profile/swapTransactionsStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

jest.mock('@/features/transactions/components/Transaction', () => ({
  Transaction: mockHost('TxRow'),
}));
jest.mock('@/features/transactions/components/SwapTransactionRow', () => ({
  SwapTransactionRow: mockHost('SwapRow'),
}));
jest.mock('@shopify/flash-list', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    FlashList: (props: {
      data: { index?: string; title: string; monthKey: string }[];
      renderItem: (args: { item: unknown; index: number }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) =>
      props.data.length === 0
        ? R.createElement('EmptyList', null, props.ListEmptyComponent)
        : props.data.map((section, index) =>
            R.createElement(
              'SectionProbe',
              {
                key: section.index ?? section.title,
                title: section.title,
                monthKey: section.monthKey,
              },
              props.renderItem({ item: section, index })
            )
          ),
  };
});
jest.mock('@/shared/ui/composed/Surface', () => ({ Surface: mockHost('Surface') }));
jest.mock('@/shared/ui/composed/SectionHeading', () => ({
  SectionHeading: mockHost('SectionHeading'),
}));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: mockHost('Spinner') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: mockHost('Text') }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: mockHost('Pressable') }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: mockHost('Spacer') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: mockHost('VStack') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('assets/icons', () => mockHost('Icon'));
jest.mock('@/shared/hooks/useScreenInsets', () => ({
  useScreenBottomPadding: () => 0,
  useScreenInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'c' : token.map(() => 'c'),
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (c: string) => c,
}));
jest.mock('@/shared/styles/appStyle', () => ({
  useStylePaint: () => ({
    style: {
      size: { control: 40 },
      radius: { control: 8 },
      type: { family: 'f' },
      space: { item: 1, section: 1, related: 1 },
    },
    secondary: { container: {}, content: 'c' },
    text: { primary: 'c', secondary: 'c', tertiary: 'c' },
    cardIsBare: false,
  }),
}));
const TESTNUT = 'https://testnut.example';
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => (mintUrl: string) => mintUrl === 'https://testnut.example',
  isTestnutMint: (mintUrl: string) => mintUrl === 'https://testnut.example',
}));
const mockNavigate = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));
jest.mock('@/shared/lib/logger', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const log: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    startSpan: () => ({ end: jest.fn() }),
  };
  log.child = () => log;
  const named: Record<string, unknown> = {
    redactError: (e: unknown) => e,
    timedDerive: (_opts: unknown, derive: () => unknown) => derive(),
    Log: ({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});

const MINT_A = 'https://a.example';
const MINT_B = 'https://b.example';
const MINT_C = 'https://c.example';
const DAY = 24 * 60 * 60 * 1000;
const NOV_3 = Date.UTC(2026, 10, 3, 12);
const NOV_2 = NOV_3 - DAY;
const OCT_20 = Date.UTC(2026, 9, 20, 12);

function entry(id: string, createdAt: number, over: Record<string, unknown> = {}): HistoryEntry {
  const value = {
    id,
    createdAt,
    amount: 100,
    unit: 'sat',
    mintUrl: MINT_A,
    type: 'receive',
    state: 'finalized',
    ...over,
  };
  return value as unknown as HistoryEntry;
}
const swapLeg = (id: string, createdAt: number, groupId: string, type: 'melt' | 'mint') =>
  entry(id, createdAt, {
    type,
    state: type === 'melt' ? 'PAID' : 'ISSUED',
    metadata: { swapGroupId: groupId },
  });

function group(id: string, createdAt: number, over: Partial<SwapGroup> = {}): SwapGroup {
  return {
    id,
    unit: 'sat',
    createdAt,
    title: 'Balance split',
    state: 'finished',
    legs: [{ id: `${id}-leg`, fromMintUrl: MINT_A, toMintUrl: MINT_B, amount: 500 }],
    ...over,
  };
}
function seedGroups(...groups: SwapGroup[]) {
  useSwapTransactionsStore.setState({
    groups: Object.fromEntries(groups.map((g) => [g.id, g])),
    quoteIdToGroup: {},
  });
}

type Props = React.ComponentProps<typeof Transactions>;
let renderer: TestRenderer.ReactTestRenderer;
async function render(props: Partial<Props> & { history: HistoryEntry[] }) {
  await act(async () => {
    renderer = TestRenderer.create(
      <Transactions account={{ unit: 'sat' }} showMore={false} {...props} />
    );
  });
  return renderer;
}

type Instance = TestRenderer.ReactTestInstance;
function rowId(node: Instance): string {
  if (node.type === ('SwapRow' as never)) return `swap:${(node.props.group as SwapGroup).id}`;
  return (node.props.historyEntry as HistoryEntry).id;
}
function rowsUnder(node: Instance): string[] {
  return node
    .findAll((n) => n.type === ('TxRow' as never) || n.type === ('SwapRow' as never))
    .map(rowId);
}
/** Virtualized list: [section title, month, row ids] per section, in order. */
function sections() {
  return renderer.root
    .findAllByType('SectionProbe' as never)
    .map((s) => [s.props.title, s.props.monthKey, rowsUnder(s)]);
}
/** Home list: [status label, day, row ids] per card, in order. */
function homeCards() {
  return renderer.root.findAllByType('Surface' as never).map((surface) => {
    const heading = surface.findAllByType('SectionHeading' as never)[0];
    return [heading?.props.label, heading?.props.detail, rowsUnder(surface)];
  });
}
const day = (ts: number) => formatDate(ts, 'long-date');

beforeEach(() => {
  mockNavigate.mockReset();
  useSettingsStore.setState({ mockMode: false });
  seedGroups();
});

afterEach(() => {
  act(() => renderer?.unmount());
});

describe('putting swap groups into the history list', () => {
  it('shows each group as one row in time order and hides the legs annotated with its id', async () => {
    seedGroups(group('g1', NOV_3 - 1000));
    await render({
      history: [
        entry('rx-new', NOV_3),
        swapLeg('leg-melt', NOV_3 - 2000, 'g1', 'melt'),
        swapLeg('leg-mint', NOV_3 - 1500, 'g1', 'mint'),
        entry('rx-old', NOV_3 - 3000),
      ],
    });

    expect(sections()).toEqual([[day(NOV_3), '2026-11', ['rx-new', 'swap:g1', 'rx-old']]]);
  });

  it('shows a group whose legs are not in history, and hides a leg whose group is not saved', async () => {
    seedGroups(group('only-in-store', NOV_2));
    await render({
      history: [entry('rx', NOV_3), swapLeg('orphan-leg', NOV_3 - 1000, 'deleted-group', 'melt')],
    });

    // QUIRK: a leg annotated with a swap id that has no saved group (e.g. the
    // store was reset) vanishes from the list with nothing standing for it.
    expect(sections()).toEqual([
      [day(NOV_3), '2026-11', ['rx']],
      [day(NOV_2), '2026-11', ['swap:only-in-store']],
    ]);
  });

  it('keeps only groups of the account’s unit; the all account keeps every group', async () => {
    seedGroups(group('sat-swap', NOV_3), group('usd-swap', NOV_3 - 1000, { unit: 'usd' }));

    await render({ history: [entry('rx', NOV_2)] });
    expect(sections()[0]![2]).toEqual(['swap:sat-swap']);

    await act(async () => {
      renderer.update(
        <Transactions account={{ unit: 'all' }} showMore={false} history={[entry('rx', NOV_2)]} />
      );
    });
    expect(sections()[0]![2]).toEqual(['swap:sat-swap', 'swap:usd-swap']);
  });

  it('ignores the mint filter and the testnut split for groups, though their legs follow them', async () => {
    seedGroups(group('b-to-c', NOV_3, { legs: [] }));
    const history = [entry('rx-a', NOV_2), entry('rx-test', NOV_2 - 1000, { mintUrl: TESTNUT })];

    await render({ history, mintUrlFilter: MINT_C });
    // QUIRK (D3): a swap between other mints still shows under mint C's filter.
    expect(sections()).toEqual([[day(NOV_3), '2026-11', ['swap:b-to-c']]]);

    await act(async () => {
      renderer.update(
        <Transactions account={{ unit: 'tsat' }} showMore={false} history={history} />
      );
    });
    // QUIRK (D3): the testnut account shows a real-mint sat swap.
    expect(sections()).toEqual([
      [day(NOV_3), '2026-11', ['swap:b-to-c']],
      [day(NOV_2), '2026-11', ['rx-test']],
    ]);
  });

  it('under a direction or type filter injects no group, and its legs stay hidden too', async () => {
    seedGroups(group('g1', NOV_3));
    await render({
      history: [swapLeg('leg-mint', NOV_3, 'g1', 'mint'), entry('rx', NOV_2)],
      filter: 'incoming',
    });

    // QUIRK: the comment above `groupedRowsShown` says legs must stay visible
    // where the group is not shown, but swap legs are hidden on every view, so
    // under a filter the swap disappears entirely.
    expect(sections()).toEqual([[day(NOV_2), '2026-11', ['rx']]]);
  });
});

describe('status and date sections', () => {
  it('puts a group in Confirmed whatever its state, pending rows first, then by day newest first', async () => {
    seedGroups(group('running', NOV_3, { state: 'running' }));
    await render({
      history: [
        entry('melt-pending', NOV_2, { type: 'melt', state: 'PENDING' }),
        entry('rx-nov2', NOV_2 - 1000),
        entry('rx-oct', OCT_20),
      ],
    });

    expect(sections()).toEqual([
      [day(NOV_2), '2026-11', ['melt-pending']],
      [day(NOV_3), '2026-11', ['swap:running']],
      [day(NOV_2), '2026-11', ['rx-nov2']],
      [day(OCT_20), '2026-10', ['rx-oct']],
    ]);
  });

  it('the Pending tab leaves groups out; the Confirmed tab keeps them', async () => {
    seedGroups(group('g1', NOV_3, { state: 'running' }));
    const history = [entry('melt-pending', NOV_2, { type: 'melt', state: 'PENDING' })];

    await render({ history, tab: 'Pending' });
    expect(sections().flatMap((s) => s[2])).toEqual(['melt-pending']);

    await act(async () => {
      renderer.update(
        <Transactions
          account={{ unit: 'sat' }}
          showMore={false}
          history={history}
          tab="Confirmed"
        />
      );
    });
    expect(sections().flatMap((s) => s[2])).toEqual(['swap:g1']);
  });

  it('reports the months in the list, including a month that only holds a swap', async () => {
    seedGroups(group('october-swap', OCT_20));
    const onMonthsChange = jest.fn();

    await render({ history: [entry('rx', NOV_3)], onMonthsChange });

    expect(onMonthsChange.mock.calls.at(-1)![0].map((m: { key: string }) => m.key)).toEqual([
      '2026-11',
      '2026-10',
    ]);
  });

  it('while the first page loads with no rows, holds the list empty even though groups are saved', async () => {
    seedGroups(group('g1', NOV_3));

    await render({ history: [], isFetching: true });

    expect(renderer.root.findAllByType('SectionProbe' as never)).toHaveLength(0);
    expect(renderer.root.findAllByType('EmptyList' as never)).toHaveLength(1);
  });
});

describe('the wallet home and the embedded list', () => {
  it('home shows only the newest day of Pending and of Confirmed, with the group in Confirmed', async () => {
    seedGroups(group('g1', NOV_3 - 1000));
    await render({
      showMore: true,
      history: [
        entry('melt-pending', NOV_2, { type: 'melt', state: 'PENDING' }),
        entry('rx-today', NOV_3),
        entry('rx-yesterday', NOV_2),
      ],
    });

    expect(homeCards()).toEqual([
      ['Pending', day(NOV_2), ['melt-pending']],
      ['Confirmed', day(NOV_3), ['rx-today', 'swap:g1']],
    ]);
  });

  it('home "View all" opens the history filtered to the account and Confirmed', async () => {
    await render({ showMore: true, history: [entry('rx', NOV_3)] });

    renderer.root.findByProps({ testID: 'transactions-view-all' }).props.onPress();

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/transactions',
      params: { filterCurrency: 'sat', filterStatus: 'Confirmed' },
    });
  });

  it('embedded injects no group, hides its legs and groups only by day, pending and settled together', async () => {
    seedGroups(group('g1', NOV_3));
    await render({
      showMore: true,
      embedded: true,
      history: [
        swapLeg('leg-melt', NOV_3, 'g1', 'melt'),
        entry('melt-pending', NOV_2, { type: 'melt', state: 'PENDING' }),
        entry('rx', NOV_2 - 1000),
      ],
    });

    // QUIRK: embedded hides the swap's legs too, with no group row in their place.
    expect(homeCards()).toEqual([[day(NOV_2), undefined, ['melt-pending', 'rx']]]);
  });

  it('embedded keeps every day, newest first, with mixed statuses in time order inside each day', async () => {
    await render({
      showMore: true,
      embedded: true,
      history: [
        entry('rx-oct', OCT_20),
        entry('rx-nov2', NOV_2 - 1000),
        entry('rx-nov3', NOV_3 - 1000),
        entry('melt-pending-nov3', NOV_3, { type: 'melt', state: 'PENDING' }),
        entry('melt-pending-nov2', NOV_2, { type: 'melt', state: 'PENDING' }),
      ],
    });

    expect(homeCards()).toEqual([
      [day(NOV_3), undefined, ['melt-pending-nov3', 'rx-nov3']],
      [day(NOV_2), undefined, ['melt-pending-nov2', 'rx-nov2']],
      [day(OCT_20), undefined, ['rx-oct']],
    ]);
  });

  it('the virtualized list splits each status bucket by day, every day kept', async () => {
    await render({
      history: [
        entry('rx-oct', OCT_20),
        entry('rx-nov2', NOV_2 - 1000),
        entry('rx-nov3', NOV_3 - 1000),
        entry('melt-pending-nov3', NOV_3, { type: 'melt', state: 'PENDING' }),
        entry('melt-pending-nov2', NOV_2, { type: 'melt', state: 'PENDING' }),
      ],
    });

    expect(sections()).toEqual([
      [day(NOV_3), '2026-11', ['melt-pending-nov3']],
      [day(NOV_2), '2026-11', ['melt-pending-nov2']],
      [day(NOV_3), '2026-11', ['rx-nov3']],
      [day(NOV_2), '2026-11', ['rx-nov2']],
      [day(OCT_20), '2026-10', ['rx-oct']],
    ]);
  });
});
