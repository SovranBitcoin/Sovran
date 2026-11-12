/**
 * @jest-environment node
 *
 * Characterization of `ColadaProvider`'s ownership of the shared payment
 * machine: which deep links it hands to the machine and when, which handler
 * map a scan reaches after the factory is replaced, and whose unit pin is in
 * force while several screens are bound. The real provider, machine and
 * detectors run; only the clipboard scan source (an injected port) and the
 * createColada instance (a fixed wallet context) are stubs.
 */

import TestRenderer, { act } from 'react-test-renderer';

import {
  ColadaProvider,
  usePaymentFlowMachine,
  type DeepLinkConfig,
} from '../../wallet/src/react/ColadaProvider';
import type { ColadaInstance } from '../../wallet/src/core/createColada';
import type { PaymentMachine, ScanSources, StepHandlerMap } from '../../wallet/src/machine/types';
import type { WalletContext } from '../../wallet/src/types';

const MINT = 'https://mint1.example.com';
// A real V3 token for MINT (same vector as the wallet machine harness).
const TOKEN =
  'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludDEuZXhhbXBsZS5jb20iLCJwcm9vZnMiOlt7ImFtb3VudCI6MSwic2VjcmV0IjoiYWJjIiwiQyI6IjAyYWJjIiwiaWQiOiIwMGFkMjY4YyJ9XX1dLCJ1bml0Ijoic2F0In0=';

const WALLET: WalletContext = {
  trustedMintUrls: [MINT],
  mintBalances: { [MINT]: 0 },
  preferredMintUrl: MINT,
  proofAmounts: {},
} as unknown as WalletContext;

const scanSources: ScanSources = { clipboard: async () => ({ empty: true }) };

const instance = {
  config: { manager: null },
  tracker: { getContext: () => WALLET },
  getWalletContext: () => WALLET,
  subscribeWalletContext: () => () => undefined,
  operations: {},
  dispose: () => undefined,
} as unknown as ColadaInstance;

type Received = { factory: string; token: string };

function makeFactory(name: string, received: Received[]) {
  return jest.fn((): StepHandlerMap => ({
    receiveToken: (data: { token: string }) => {
      received.push({ factory: name, token: data.token });
    },
  })) as unknown as jest.Mock & ((machine: PaymentMachine) => StepHandlerMap);
}

let machineSeen: PaymentMachine | null = null;

function Binder({
  unit,
  walletContext = WALLET,
}: {
  unit?: string;
  walletContext?: WalletContext;
}) {
  machineSeen = usePaymentFlowMachine({ walletContext, unit });
  return null;
}

interface TreeProps {
  handlers: (machine: PaymentMachine) => StepHandlerMap;
  deepLinks?: DeepLinkConfig;
  binders?: { key: string; unit?: string }[];
  getUnit?: () => string;
  withScanSource?: boolean;
}

function Tree({
  handlers,
  deepLinks,
  binders = [{ key: 'a' }],
  getUnit,
  withScanSource = true,
}: TreeProps) {
  return (
    <ColadaProvider
      handlers={handlers}
      instance={instance}
      deepLinks={deepLinks}
      getUnit={getUnit}
      scanSources={withScanSource ? scanSources : undefined}>
      {binders.map((b) => (
        <Binder key={b.key} unit={b.unit} />
      ))}
    </ColadaProvider>
  );
}

let renderer: TestRenderer.ReactTestRenderer | null = null;

async function mount(props: TreeProps) {
  await act(async () => {
    renderer = TestRenderer.create(<Tree {...props} />);
  });
}

async function update(props: TreeProps) {
  await act(async () => {
    renderer!.update(<Tree {...props} />);
  });
}

function unitOnReset(): string {
  machineSeen!.reset();
  return machineSeen!.getContext().unit;
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  machineSeen = null;
});

describe('deep links', () => {
  test('a cashu: link is scanned once, after onBeforeScan, into the receive handler', async () => {
    const received: Received[] = [];
    const order: string[] = [];
    const handlers = makeFactory('first', received);
    const deepLinks: DeepLinkConfig = {
      url: `cashu:${TOKEN}`,
      onBeforeScan: () => order.push('beforeScan'),
      onError: jest.fn(),
    };
    await mount({ handlers, deepLinks });

    expect(order).toEqual(['beforeScan']);
    expect(received).toEqual([{ factory: 'first', token: TOKEN }]);
    expect(deepLinks.onError).not.toHaveBeenCalled();
  });

  test('re-rendering with the same URL in a new options object does not scan again', async () => {
    const received: Received[] = [];
    const handlers = makeFactory('first', received);
    const onBeforeScan = jest.fn();
    await mount({ handlers, deepLinks: { url: `cashu:${TOKEN}`, onBeforeScan } });
    await update({ handlers, deepLinks: { url: `cashu:${TOKEN}`, onBeforeScan } });
    await update({ handlers, deepLinks: { url: `cashu:${TOKEN}`, onBeforeScan } });

    expect(onBeforeScan).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
  });

  test('a link that arrives after the handler factory changed reaches the new handlers', async () => {
    const received: Received[] = [];
    const first = makeFactory('first', received);
    const second = makeFactory('second', received);
    await mount({ handlers: first, deepLinks: { url: null } });
    await update({ handlers: second, deepLinks: { url: null } });
    await update({ handlers: second, deepLinks: { url: `cashu://${TOKEN}` } });

    expect(received).toEqual([{ factory: 'second', token: TOKEN }]);
  });

  test('a custom scheme is accepted whatever its case; other schemes are ignored', async () => {
    const received: Received[] = [];
    const handlers = makeFactory('first', received);
    const onBeforeScan = jest.fn();
    await mount({
      handlers,
      deepLinks: { url: `bitcoin:${TOKEN}`, customSchemes: ['Sovran'], onBeforeScan },
    });
    expect(onBeforeScan).not.toHaveBeenCalled();
    expect(received).toEqual([]);

    await update({
      handlers,
      deepLinks: { url: `SOVRAN://${TOKEN}`, customSchemes: ['Sovran'], onBeforeScan },
    });
    expect(onBeforeScan).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{ factory: 'first', token: TOKEN }]);
  });

  test('an ignored host is left to the router and never scanned', async () => {
    const received: Received[] = [];
    const onBeforeScan = jest.fn();
    const onError = jest.fn();
    await mount({
      handlers: makeFactory('first', received),
      deepLinks: {
        url: 'sovran://camera',
        customSchemes: ['sovran'],
        ignoredHosts: ['camera'],
        onBeforeScan,
        onError,
      },
    });

    expect(onBeforeScan).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  test('a host over 16384 characters reports DEEP_LINK_TOO_LONG and is not scanned', async () => {
    const received: Received[] = [];
    const onBeforeScan = jest.fn();
    const onError = jest.fn();
    await mount({
      handlers: makeFactory('first', received),
      deepLinks: { url: `cashu:${'a'.repeat(16385)}`, onBeforeScan, onError },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('DEEP_LINK_TOO_LONG');
    expect(onBeforeScan).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  test('a host of exactly 16384 characters is still handed to the machine', async () => {
    const onBeforeScan = jest.fn();
    const onError = jest.fn();
    await mount({
      handlers: makeFactory('first', []),
      deepLinks: { url: `cashu:${'a'.repeat(16384)}`, onBeforeScan, onError },
    });

    expect(onBeforeScan).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'DEEP_LINK_TOO_LONG' })
    );
  });

  test('a provider with no scan source ignores deep links entirely', async () => {
    const received: Received[] = [];
    const onBeforeScan = jest.fn();
    await mount({
      handlers: makeFactory('first', received),
      deepLinks: { url: `cashu:${TOKEN}`, onBeforeScan },
      withScanSource: false,
    });

    expect(onBeforeScan).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });
});

describe('unit pins', () => {
  test('without a pin the flow reset uses the app getUnit, then sat', async () => {
    await mount({ handlers: makeFactory('first', []), getUnit: () => 'usd' });
    expect(unitOnReset()).toBe('usd');

    act(() => renderer?.unmount());
    renderer = null;
    await mount({ handlers: makeFactory('first', []) });
    expect(unitOnReset()).toBe('sat');
  });

  test('the newest pin wins, and releasing the older one leaves the newer in force', async () => {
    const handlers = makeFactory('first', []);
    const getUnit = () => 'usd';
    await mount({ handlers, getUnit, binders: [{ key: 'a', unit: 'eur' }] });
    expect(unitOnReset()).toBe('eur');

    await update({
      handlers,
      getUnit,
      binders: [
        { key: 'a', unit: 'eur' },
        { key: 'b', unit: 'sat' },
      ],
    });
    expect(unitOnReset()).toBe('sat');

    await update({ handlers, getUnit, binders: [{ key: 'b', unit: 'sat' }] });
    expect(unitOnReset()).toBe('sat');

    await update({ handlers, getUnit, binders: [] });
    expect(unitOnReset()).toBe('usd');
  });

  test('two screens pinning the same unit each release only their own pin', async () => {
    const handlers = makeFactory('first', []);
    const getUnit = () => 'usd';
    await mount({
      handlers,
      getUnit,
      binders: [
        { key: 'a', unit: 'sat' },
        { key: 'b', unit: 'sat' },
      ],
    });
    await update({ handlers, getUnit, binders: [{ key: 'b', unit: 'sat' }] });
    expect(unitOnReset()).toBe('sat');

    await update({ handlers, getUnit, binders: [] });
    expect(unitOnReset()).toBe('usd');
  });

  test('a screen that changes its unit drops its old pin', async () => {
    const handlers = makeFactory('first', []);
    const getUnit = () => 'usd';
    await mount({ handlers, getUnit, binders: [{ key: 'a', unit: 'eur' }] });
    await update({ handlers, getUnit, binders: [{ key: 'a', unit: 'sat' }] });
    expect(unitOnReset()).toBe('sat');

    await update({ handlers, getUnit, binders: [{ key: 'a' }] });
    expect(unitOnReset()).toBe('usd');
  });
});
