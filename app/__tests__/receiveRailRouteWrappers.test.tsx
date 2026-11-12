/** @jest-environment node */
import TestRenderer, { act } from 'react-test-renderer';

import ActiveLightning from '@/app/(receive-flow)/lightningReceive';
import ActiveOnchain from '@/app/(receive-flow)/onchainReceive';
import HistoryLightning from '@/app/(transactions-flow)/lightningReceive';
import HistoryOnchain from '@/app/(transactions-flow)/onchainReceive';
import { cashuLog } from '@/shared/lib/logger';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The standing-rail receive routes, from the expo-router file down to the
// screen: which params reach it, whether its mint pill is editable, and how
// the active flow binds the payment machine.
let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockBind = jest.fn();
const mockMachine = { requestMintSelector: jest.fn(async () => undefined) };
const mockWalletContext = {
  trustedMintUrls: ['https://mint.example'],
  mintBalances: { 'https://mint.example': 5 },
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: { back: (...args: unknown[]) => mockBack(...args) },
  Stack: { Screen: () => null },
}));
jest.mock('@/features/receive', () => ({
  LightningReceiveRoute: jest.requireActual<
    typeof import('@/features/receive/screens/LightningReceiveRoute')
  >('@/features/receive/screens/LightningReceiveRoute').LightningReceiveRoute,
  OnchainReceiveRoute: jest.requireActual<
    typeof import('@/features/receive/screens/OnchainReceiveRoute')
  >('@/features/receive/screens/OnchainReceiveRoute').OnchainReceiveRoute,
}));
jest.mock('@/features/receive/screens/LightningReceiveScreen', () => ({
  LightningReceiveScreen: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import('react')>('react').createElement('lightning-screen', props),
}));
jest.mock('@/features/receive/screens/OnchainReceiveScreen', () => ({
  OnchainReceiveScreen: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import('react')>('react').createElement('onchain-screen', props),
}));
jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: (config: unknown) => {
    mockBind(config);
    return mockMachine;
  },
  useColadaContext: () => ({ machine: mockMachine }),
  useScreenActions: () => ({
    entry: { state: 'UNPAID', unit: 'sat', mintUrl: 'https://mint.example' },
    error: null,
    actions: { back: { execute: jest.fn() } },
    source: 'history',
    mintUrl: 'https://mint.example',
  }),
}));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => mockWalletContext,
}));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: () => null }));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: () => null,
  ScreenLoadingState: () => null,
}));
jest.mock('@/shared/lib/logger', () => {
  const channel = () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() });
  return { cashuLog: channel(), paymentLog: channel(), log: channel() };
});

const ENTRY = JSON.stringify({ type: 'mintQuote', quoteId: 'fixture' });
const ROUTES = [
  {
    rail: 'lightning',
    screen: 'lightning-screen',
    Active: ActiveLightning,
    History: HistoryLightning,
  },
  { rail: 'onchain', screen: 'onchain-screen', Active: ActiveOnchain, History: HistoryOnchain },
] as const;

let now = 0;
beforeEach(() => {
  jest.clearAllMocks();
  // The guarded router collapses a repeated back inside its cooldown; step
  // past it so each test starts with a fresh window.
  now += 10_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

function mount(Route: () => React.ReactElement | null) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Route />);
  });
  return renderer;
}

describe.each(ROUTES)('$rail receive routes', ({ rail, screen, Active, History }) => {
  it('gives the active flow an editable mint pill bound to the route unit', async () => {
    mockParams = { mintHistoryEntry: ENTRY, unit: 'usd' };
    const renderer = mount(Active);
    const node = renderer.root.find((n) => n.type === (screen as string));
    expect(node.props.mintHistoryEntry ?? node.props.entry).toBeTruthy();
    expect(mockBind).toHaveBeenLastCalledWith({ walletContext: mockWalletContext, unit: 'usd' });
    expect(cashuLog.info).toHaveBeenCalledWith(`receive.${rail}.route.ready`, {
      where: `receive-flow.${rail}Receive`,
      unit: 'usd',
      hasEntry: true,
      entryLength: ENTRY.length,
      trustedMintCount: 1,
      balanceMintCount: 1,
    });
    await act(async () => node.props.onRequestMintList());
    expect(mockMachine.requestMintSelector).toHaveBeenCalledTimes(1);
    expect(cashuLog.info).toHaveBeenLastCalledWith(`receive.${rail}.mint_list.requested`, {
      source: 'pill',
    });
    expect(mockBack).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('leaves the unit to the active account when the route carries none', () => {
    mockParams = { mintHistoryEntry: ENTRY };
    const renderer = mount(Active);
    expect(mockBind).toHaveBeenLastCalledWith({ walletContext: mockWalletContext });
    act(() => renderer.unmount());
  });

  it('shows a history entry read-only, without binding the payment machine', () => {
    mockParams = { mintHistoryEntry: ENTRY, unit: 'sat' };
    const renderer = mount(History);
    expect(
      renderer.root.find((n) => n.type === (screen as string)).props.onRequestMintList
    ).toBeUndefined();
    expect(mockBind).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it.each([{}, { mintHistoryEntry: '' }, { mintHistoryEntry: ENTRY, unit: 'x'.repeat(17) }])(
    'goes back once and renders nothing for malformed params %#',
    (params) => {
      mockParams = params as Record<string, string>;
      for (const Route of [Active, History]) {
        now += 10_000;
        mockBack.mockClear();
        mockBind.mockClear();
        const renderer = mount(Route);
        expect(renderer.root.findAll((n) => n.type === (screen as string))).toHaveLength(0);
        expect(mockBack).toHaveBeenCalledTimes(1);
        // The active flow binds the machine to the live account as it leaves.
        expect(mockBind).toHaveBeenCalledTimes(Route === Active ? 1 : 0);
        act(() => renderer.unmount());
      }
    }
  );
});
