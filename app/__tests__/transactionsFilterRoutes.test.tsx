/**
 * The two route encodings of the transaction filters. Transactions opens the
 * filter sheet with every filter under its own name (`currency`, `status`, ...);
 * the sheet, the balance's pending link and the list's "View all" open
 * Transactions with `filter`-prefixed params, of which only the ones present
 * and non-empty change a filter. Deep links use the same params, so these
 * encodings and their defaults must not drift.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import TransactionsRoute from '@/app/(transactions-flow)/transactions';
import { TransactionsFilterProvider } from '@/features/transactions/components/TransactionsFilterContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockRaw: Record<string, string> = {};
let mockScreenProps: Record<string, unknown> | null = null;
const mockNavigate = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRaw,
  // The header's right item, drawn in place so it reads the same filters.
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => React.ReactElement } }) =>
      options.headerRight?.() ?? null,
  },
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: () => mockBack(),
  },
}));
jest.mock('@/features/transactions', () => ({
  ...jest.requireActual('@/features/transactions/components/TransactionsFilterContext'),
  TransactionsScreen: (props: Record<string, unknown>) => {
    mockScreenProps = props;
    return null;
  },
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: (props: object) =>
    jest.requireActual('react').createElement('HeaderAction', props),
}));
jest.mock('@/navigation/headerItems', () => ({
  withGlassHeaderItems: (options: object) => options,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string[]) => tokens.map(() => 'rgb(0, 0, 0)'),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/lib/nav/transactionDetailRoutes', () => ({
  navigateToTransactionDetail: jest.fn(),
}));
jest.mock('@sovranbitcoin/schemas', () => ({ loggableIssues: () => [] }));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { info: jest.fn() },
  log: { warn: jest.fn() },
}));

const DEFAULT_SHEET_PARAMS = {
  currency: 'sat',
  paymentType: 'all',
  direction: 'all',
  status: 'All',
  mintUrl: 'all',
  source: 'all',
  lock: 'all',
  counterparty: 'all',
  zap: 'all',
};

const EVERY_FILTER = {
  filterCurrency: 'usd',
  filterPaymentType: 'ecash',
  filterDirection: 'outgoing',
  filterStatus: 'Pending',
  filterMintUrl: 'https://mint.example',
  filterSource: 'nfc',
  filterLock: 'locked',
  filterCounterparty: 'with',
  filterZap: 'zaps',
};

let renderer: TestRenderer.ReactTestRenderer;
const tree = () => (
  <TransactionsFilterProvider>
    <TransactionsRoute />
  </TransactionsFilterProvider>
);
function open(raw: Record<string, string>) {
  mockRaw = raw;
  act(() => {
    renderer = TestRenderer.create(tree());
  });
}
function arrive(raw: Record<string, string>) {
  mockRaw = raw;
  act(() => renderer.update(tree()));
}
function header() {
  const button = renderer.root.findByType('HeaderAction' as never);
  const badge = button.props.accessory;
  return {
    press: () => void act(() => button.props.onPress()),
    // The badge is a View around the count's Text.
    badge: badge ? badge.props.children.props.children : 0,
  };
}
function sheetParams() {
  header().press();
  return mockNavigate.mock.calls.at(-1)[0];
}

beforeEach(() => {
  mockScreenProps = null;
  mockNavigate.mockClear();
  mockBack.mockClear();
});
afterEach(() => act(() => renderer?.unmount()));

it('opens the sheet with every filter under its own name, at its default', () => {
  open({});
  expect(sheetParams()).toEqual({ pathname: '/filters', params: DEFAULT_SHEET_PARAMS });
  expect(header().badge).toBe(0);
  expect(mockScreenProps).toMatchObject({
    initialTab: 'All',
    filterCurrency: 'sat',
    filterPaymentType: 'all',
    filterDirection: 'all',
    filterMintUrl: 'all',
    filterSource: 'all',
    filterLock: 'all',
    filterCounterparty: 'all',
    filterZap: 'all',
    filterMonth: null,
  });
});

it('takes every filter param, shows it on the list and the badge, and hands it back to the sheet', () => {
  open(EVERY_FILTER);
  expect(mockScreenProps).toMatchObject({
    initialTab: 'Pending',
    filterCurrency: 'usd',
    filterPaymentType: 'ecash',
    filterDirection: 'outgoing',
    filterMintUrl: 'https://mint.example',
    filterSource: 'nfc',
    filterLock: 'locked',
    filterCounterparty: 'with',
    filterZap: 'zaps',
  });
  expect(header().badge).toBe(9);
  expect(sheetParams()).toEqual({
    pathname: '/filters',
    params: {
      currency: 'usd',
      paymentType: 'ecash',
      direction: 'outgoing',
      status: 'Pending',
      mintUrl: 'https://mint.example',
      source: 'nfc',
      lock: 'locked',
      counterparty: 'with',
      zap: 'zaps',
    },
  });
});

it('changes only the filters a later visit names, and ignores empty ones', () => {
  open(EVERY_FILTER);
  // The list's "View all" link.
  arrive({ filterCurrency: 'eur', filterStatus: 'Confirmed', filterMintUrl: '' });
  expect(sheetParams().params).toEqual({
    currency: 'eur',
    paymentType: 'ecash',
    direction: 'outgoing',
    status: 'Confirmed',
    mintUrl: 'https://mint.example',
    source: 'nfc',
    lock: 'locked',
    counterparty: 'with',
    zap: 'zaps',
  });
});

it('puts a filter back to its default only when a param names the default', () => {
  open(EVERY_FILTER);
  // The balance's pending link.
  arrive({
    filterCurrency: 'sat',
    filterPaymentType: 'ecash',
    filterDirection: 'outgoing',
    filterStatus: 'Pending',
    filterMintUrl: 'all',
  });
  expect(sheetParams().params).toEqual({
    currency: 'sat',
    paymentType: 'ecash',
    direction: 'outgoing',
    status: 'Pending',
    mintUrl: 'all',
    source: 'nfc',
    lock: 'locked',
    counterparty: 'with',
    zap: 'zaps',
  });
  expect(header().badge).toBe(7);
});

it.each([
  ['an unknown status', { filterStatus: 'Bogus' }],
  ['an empty choice', { filterZap: '' }],
  ['an unknown source', { filterSource: 'carrier-pigeon' }],
  ['a currency longer than sixteen characters', { filterCurrency: 'x'.repeat(17) }],
  ['a mint address longer than 2048 characters', { filterMintUrl: 'x'.repeat(2049) }],
])('turns away %s and shows nothing', (_name, raw) => {
  open(raw);
  expect(mockScreenProps).toBeNull();
  expect(mockBack).toHaveBeenCalled();
});
