/**
 * @jest-environment node
 *
 * Characterization of SovranColadaProvider as assembled: what it hands the
 * wallet package's ColadaProvider for each port (handlers, notifications,
 * scan sources, adapters, operations, deep links, unit, navigation), and what
 * it does on its own (offline flag on the manager, data migrations, disposal).
 * The wallet package's provider is replaced by a recorder of its props; the
 * wallet factories (`createColada`, receive and mint-quote operations) run for
 * real against a fake manager; the app's payment config factories are
 * replaced so which port receives which factory result is visible.
 */

/* eslint-disable import/first */

const mockBaseProps: { current: Record<string, unknown> | null } = { current: null };
const mockRouter = {
  navigate: jest.fn(),
  push: jest.fn(),
  back: jest.fn(),
};
const mockNfcAdapter = { kind: 'nfc adapter' };
const mockScanSources = { kind: 'scan sources' };
const mockActions = { kind: 'screen actions' };
const mockNotifications = { kind: 'notifications' };
const mockHandlerMap = { kind: 'handler map' };
const mockBridge = { kind: 'screen actions bridge' };
let mockUrl: string | null = null;
let mockKeys: { pubkey: string } | null = { pubkey: 'ab'.repeat(32) };
let mockOffline = false;
let mockPermission = true;

jest.mock('@react-native-async-storage/async-storage', () => {
  const disk: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => disk[k] ?? null,
      setItem: async (k: string, v: string) => {
        disk[k] = v;
      },
      removeItem: async (k: string) => {
        delete disk[k];
      },
    },
  };
});
jest.mock('wallet/react', () => ({
  ColadaProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    mockBaseProps.current = props;
    return children;
  },
}));
jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManagerHolder.current }));
jest.mock('expo-router', () => ({
  useNavigationContainerRef: () => ({ isReady: () => false, getRootState: () => undefined }),
  router: {},
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  get guardedRouter() {
    return mockRouter;
  },
}));
jest.mock('expo-linking', () => ({ useURL: () => mockUrl }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: mockOffline }),
}));
jest.mock('@/features/camera/hooks/useHandleCameraPermission', () => ({
  useHandleCameraPermission: () => ({ handlePermission: async () => mockPermission }),
}));
jest.mock('@/shared/lib/nfc', () => ({ createNfcAdapter: () => mockNfcAdapter }));
jest.mock('@/shared/lib/migrations/dataMigrations', () => ({
  runDataMigrations: jest.fn(async () => undefined),
}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: jest.fn() }));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({ actionMenuSheet: jest.fn() }));
jest.mock('@/features/send/lib/sovranPaymentConfig', () => ({
  createSovranHandlers: jest.fn(() => mockHandlerMap),
  createSovranNotifications: jest.fn(() => mockNotifications),
  createSovranScanSources: jest.fn(() => mockScanSources),
  createSovranScreenActionHandlers: jest.fn(() => mockActions),
}));
jest.mock('@/features/send/lib/createSovranScreenActionsBridge', () => ({
  createSovranScreenActionsBridge: jest.fn(() => mockBridge),
  getSovranMintEnrichment: jest.fn(),
}));
jest.mock('@/shared/lib/cashu/cocoOperations', () => ({
  prepareBolt11MintQuote: jest.fn(async () => {
    throw new Error('stop after choosing bolt11');
  }),
  prepareOnchainMintQuote: jest.fn(async () => {
    throw new Error('stop after choosing onchain');
  }),
}));

const mockManagerHolder: { current: unknown } = { current: null };

import React from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { URDecoder } from '@gandlaf21/bc-ur';
import { act, render } from '@testing-library/react-native';
import type { MachineOperations, NavigationCallbacks } from 'wallet';
import type { DeepLinkConfig } from 'wallet/react';

import { SovranColadaProvider } from '@/features/send/providers/Colada';
import {
  createSovranHandlers,
  createSovranNotifications,
  createSovranScanSources,
} from '@/features/send/lib/sovranPaymentConfig';
import { createSovranScreenActionsBridge } from '@/features/send/lib/createSovranScreenActionsBridge';
import { prepareBolt11MintQuote, prepareOnchainMintQuote } from '@/shared/lib/cashu/cocoOperations';
import { runDataMigrations } from '@/shared/lib/migrations/dataMigrations';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { staticPopup } from '@/shared/lib/popup';
import { buildDetectors } from '@/shared/config/featureDetectors';
import { transactionAnnotationAdapter } from '@/shared/stores/profile/transactionAnnotationStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

const MINT = 'https://mint.example';

/** Hands a callback the loose shape the wallet types more narrowly. */
const loose = (value: object): never => value as never;

function fakeManager() {
  return {
    setOffline: jest.fn(),
    on: jest.fn(() => () => undefined),
    off: jest.fn(),
    mint: { getMintInfo: jest.fn() },
    history: { getPaginatedHistory: jest.fn(async () => []) },
  };
}

function props() {
  return mockBaseProps.current as {
    handlers: (machine: unknown, refs: { getOptionDismiss: () => unknown }) => unknown;
    detectors: unknown;
    instance: { dispose: () => void; operations: MachineOperations; config: { manager: unknown } };
    annotationStore: unknown;
    operations: MachineOperations & {
      npcAddressForPubkey: unknown;
      switchUnit: (unit: string) => void;
    };
    notifications: unknown;
    actions: unknown;
    screenActionsBridge: unknown;
    clipboardAdapter: { writeText: (text: string) => Promise<void> };
    shareAdapter: {
      share: (content: { message: string; url?: string; title?: string }) => Promise<void>;
    };
    nfcAdapter: unknown;
    chainAdapter: unknown;
    scanSources: unknown;
    qrDecoderAdapter: {
      decode: (input: unknown) => Promise<unknown>;
      createUrDecoder: () => unknown;
    };
    deepLinks: DeepLinkConfig;
    getUnit: () => string;
    navigation: NavigationCallbacks;
  };
}

async function mount() {
  const view = render(
    <SovranColadaProvider>
      <></>
    </SovranColadaProvider>
  );
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.clearAllMocks();
  mockBaseProps.current = null;
  mockManagerHolder.current = fakeManager();
  mockUrl = null;
  mockKeys = { pubkey: 'ab'.repeat(32) };
  mockOffline = false;
  mockPermission = true;
  useSettingsStore.setState({ mockOffline: false });
  useMintStore.setState({ activeUnit: 'sat' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ports handed to the wallet provider', () => {
  it('wires the app factories, detectors and annotation store to their ports', async () => {
    await mount();
    const p = props();

    expect(p.detectors).toBe(buildDetectors);
    expect(p.annotationStore).toBe(transactionAnnotationAdapter);
    expect(p.actions).toBe(mockActions);
    expect(p.notifications).toBe(mockNotifications);
    expect(p.nfcAdapter).toBe(mockNfcAdapter);
    expect(p.scanSources).toBe(mockScanSources);
    expect(createSovranScanSources).toHaveBeenCalledWith(mockNfcAdapter);
    expect(p.screenActionsBridge).toBe(mockBridge);
    expect(createSovranScreenActionsBridge).toHaveBeenCalledWith(
      expect.objectContaining({ manager: mockManagerHolder.current })
    );
    expect(p.instance.config.manager).toBe(mockManagerHolder.current);
    expect(p.chainAdapter).toEqual(
      expect.objectContaining({ getAddressTransactions: expect.any(Function) })
    );
    const notificationsConfig = jest.mocked(createSovranNotifications).mock.calls[0]![0] as unknown as {
      getManager: () => unknown;
    };
    expect(notificationsConfig.getManager()).toBe(mockManagerHolder.current);
  });

  it('builds the step handlers from the machine with the live manager', async () => {
    await mount();
    const machine = { kind: 'machine' };
    const dismiss = jest.fn();

    const map = props().handlers(machine, { getOptionDismiss: () => dismiss });

    expect(map).toBe(mockHandlerMap);
    const config = jest.mocked(createSovranHandlers).mock.calls[0]![0] as unknown as {
      machine: unknown;
      getManager: () => unknown;
      onOptionDismiss: () => void;
      getRootNavigationState: () => unknown;
    };
    expect(config.machine).toBe(machine);
    expect(config.getManager()).toBe(mockManagerHolder.current);
    config.onOptionDismiss();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(config.getRootNavigationState()).toBeUndefined();
  });

  it('copies through the clipboard and shares through the system sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await mount();

    await props().clipboardAdapter.writeText('cashuB...');
    await props().shareAdapter.share({ message: 'm', url: 'u', title: 't' });

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('cashuB...');
    expect(share).toHaveBeenCalledWith({ message: 'm', url: 'u', title: 't' });
  });

  it('decodes no QR image itself and hands out a fresh UR decoder each time', async () => {
    await mount();
    const qr = props().qrDecoderAdapter;

    await expect(qr.decode('anything')).resolves.toBeNull();
    const first = qr.createUrDecoder();
    expect(first).toBeInstanceOf(URDecoder);
    expect(qr.createUrDecoder()).not.toBe(first);
  });

  it('runs the data migrations once on mount', async () => {
    const view = await mount();
    view.rerender(
      <SovranColadaProvider>
        <></>
      </SovranColadaProvider>
    );

    expect(runDataMigrations).toHaveBeenCalledTimes(1);
  });
});

describe('unit and operations', () => {
  it('speaks the real unit to the wallet while a testnut account is active', async () => {
    useMintStore.setState({ activeUnit: 'tsat' as never });
    await mount();

    expect(props().getUnit()).toBe('sat');
  });

  it('switches to the same side of the testnut split', async () => {
    useMintStore.setState({ activeUnit: 'tsat' as never });
    await mount();

    void props().operations.switchUnit('usd');
    expect(useMintStore.getState().activeUnit).toBe('tusd');

    useMintStore.setState({ activeUnit: 'sat' });
    void props().operations.switchUnit('USD');
    expect(useMintStore.getState().activeUnit).toBe('usd');
  });

  it('ignores a switch to a unit that is no account', async () => {
    await mount();

    void props().operations.switchUnit('doge');

    expect(useMintStore.getState().activeUnit).toBe('sat');
  });

  it.each([
    ['onchain', prepareOnchainMintQuote, prepareBolt11MintQuote],
    ['bolt11', prepareBolt11MintQuote, prepareOnchainMintQuote],
  ] as const)(
    'routes a %s mint quote to its quote-first wrapper with the live manager',
    async (method, chosen, other) => {
      await mount();

      await expect(
        props().operations.executeMintQuote!({ mintUrl: MINT, amount: 21, unit: 'sat', method })
      ).rejects.toThrow(`stop after choosing ${method}`);

      expect(chosen).toHaveBeenCalledWith(mockManagerHolder.current, MINT, 21, 'sat');
      expect(other).not.toHaveBeenCalled();
    }
  );

  it('keeps every other wallet operation and overrides receive and mint quote', async () => {
    await mount();
    const { operations, instance } = props();

    expect(operations.executeSend).toBe(instance.operations.executeSend);
    expect(operations.executeMelt).toBe(instance.operations.executeMelt);
    expect(operations.executeReceive).not.toBe(instance.operations.executeReceive);
    expect(operations.executeMintQuote).not.toBe(instance.operations.executeMintQuote);
    expect(typeof operations.npcAddressForPubkey).toBe('function');
    expect(typeof operations.resolveRecipientProfile).toBe('function');
  });
});

describe('offline flag and lifetime', () => {
  it('tells the manager whether the app is offline, including the developer mock', async () => {
    const view = await mount();
    const manager = mockManagerHolder.current as ReturnType<typeof fakeManager>;
    expect(manager.setOffline).toHaveBeenLastCalledWith(false);

    await act(async () => useSettingsStore.setState({ mockOffline: true }));
    expect(manager.setOffline).toHaveBeenLastCalledWith(true);
    view.unmount();
  });

  it('disposes the wallet instance on unmount and when the manager changes', async () => {
    const view = await mount();
    const first = props().instance;
    const disposeFirst = jest.spyOn(first, 'dispose');

    mockManagerHolder.current = fakeManager();
    view.rerender(
      <SovranColadaProvider>
        <></>
      </SovranColadaProvider>
    );
    expect(disposeFirst).toHaveBeenCalledTimes(1);
    const second = props().instance;
    expect(second).not.toBe(first);

    const disposeSecond = jest.spyOn(second, 'dispose');
    view.unmount();
    expect(disposeSecond).toHaveBeenCalledTimes(1);
  });
});

describe('deep links', () => {
  it('passes no link until the account has keys', async () => {
    mockUrl = 'cashu:cashuBtoken';
    mockKeys = null;
    await mount();

    expect(props().deepLinks.url).toBeNull();
  });

  it('passes the launch link with the sovran scheme and the router-owned hosts', async () => {
    mockUrl = 'sovran://cashuBtoken';
    await mount();
    const links = props().deepLinks;

    expect(links.url).toBe('sovran://cashuBtoken');
    expect(links.customSchemes).toEqual(['sovran']);
    expect(links.ignoredHosts).toEqual(['camera', 'expo-development-client']);

    links.onBeforeScan!();
    expect(clearPaymentContext).toHaveBeenCalledWith('send.deeplink');
    links.onError!(new Error('bad link'));
    expect(staticPopup).toHaveBeenCalledWith('deeplink-failed');
  });
});

describe('navigation callbacks', () => {
  it.each([
    ['receive', '/(receive-flow)/camera'],
    ['send', '/camera'],
  ] as const)('opens the %s camera after permission is granted', async (context, pathname) => {
    await mount();

    props().navigation.scanQr!(loose({ unit: 'sat', context }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname, params: { unit: 'sat' } });
  });

  it('opens no camera when permission is refused', async () => {
    mockPermission = false;
    await mount();

    props().navigation.scanQr!(loose({ unit: 'sat', context: 'receive' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('opens nearby, mint info, add mint and back', async () => {
    await mount();
    const nav = props().navigation;

    nav.nutDrop!(loose({ unit: 'sat' }));
    nav.mintInfo!('{"mintUrl":"x"}' as never);
    nav.addMint!();
    nav.goBack!();

    expect(clearPaymentContext).toHaveBeenCalledWith('send.near_pay');
    expect(mockRouter.push.mock.calls).toEqual([['/(send-flow)/nearPay'], ['/(mint-flow)/add']]);
    expect(mockRouter.navigate).toHaveBeenCalledWith({
      pathname: '/(mint-flow)/info',
      params: { mintInfoEntry: '{"mintUrl":"x"}' },
    });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
