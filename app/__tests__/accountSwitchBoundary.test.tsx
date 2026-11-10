/**
 * @jest-environment node
 *
 * Characterization of the account switch boundary and the providers under it.
 *
 * `AccountSwitchBoundary` registers suspend/resume with the account registry;
 * the in-process profile switch calls them. Pinned at what that caller and the
 * person observe: when each promise settles relative to the account tree
 * unmounting or mounting again, and which navigation reset is issued.
 *
 * `AccountScopedProviders` composes the per-account providers. Each provider is
 * replaced by a recorder, so the nesting order and what a change of account key
 * tears down and mounts again are visible.
 */

/* eslint-disable import/first */

const mockEvents: string[] = [];
const mockFeatures = new Set<string>();

function mockRecorder(name: string) {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return function Recorder({ children, ...props }: { children?: React.ReactNode }) {
    const label = Object.keys(props).length ? `${name}${JSON.stringify(props)}` : name;
    ReactActual.useEffect(() => {
      mockEvents.push(`mount ${label}`);
      return () => {
        mockEvents.push(`unmount ${label}`);
      };
    }, [label]);
    return ReactActual.createElement(`provider:${name}`, null, children);
  };
}

const mockNavigation = {
  isReady: jest.fn(() => true),
  getRootState: jest.fn((): unknown => ({ type: 'stack', routes: [{}] })),
  resetRoot: jest.fn(),
};

jest.mock('expo-router', () => ({ useNavigationContainerRef: () => mockNavigation }));
jest.mock('@/shared/config/features', () => ({ hasFeature: (f: string) => mockFeatures.has(f) }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  NostrKeysProvider: mockRecorder('NostrKeys'),
}));
jest.mock('@/shared/providers/NostrNDKProvider', () => ({
  NostrNDKProvider: mockRecorder('NostrNDK'),
}));
jest.mock('@/shared/providers/NostrSignerProvider', () => ({
  NostrSignerProvider: mockRecorder('NostrSigner'),
}));
jest.mock('@/features/whitenoise/WhitenoiseProvider', () => ({
  WhitenoiseProvider: mockRecorder('Whitenoise'),
}));
jest.mock('@/shared/providers/CocoProvider', () => ({ CocoProvider: mockRecorder('Coco') }));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  WalletContextProvider: mockRecorder('WalletContext'),
}));
jest.mock('@/features/send/providers/Colada', () => ({
  SovranColadaProvider: mockRecorder('Colada'),
}));
jest.mock('@/shared/providers/PricelistProvider', () => ({
  PricelistProvider: mockRecorder('Pricelist'),
}));
jest.mock('@/shared/providers/BitchatBLEProvider', () => ({
  BitchatBLEProvider: mockRecorder('BitchatBLE'),
}));
jest.mock('@/features/payments/hooks/useDmEcashAutoRedeem', () => ({
  DmEcashAutoRedeemProvider: mockRecorder('DmEcashAutoRedeem'),
}));
jest.mock('@/shared/blocks/AppGate', () => ({
  __esModule: true,
  default: mockRecorder('AppGate'),
}));
jest.mock('@/shared/hooks/useRegisterKeyDerivation', () => ({
  useRegisterKeyDerivation: jest.fn(),
}));
jest.mock('@/shared/lib/persist/storageUsage', () => ({ reportAsyncStorageUsage: jest.fn() }));
jest.mock('@/shared/lib/profile/profileTransition', () => ({
  clearTransitionGuardOnStartup: jest.fn(),
  registerTransitionControls: jest.fn(),
}));

import React, { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { AccountScopedProviders, AccountSwitchBoundary } from '@/shared/providers/AccountProviders';
import { profileSwitchBoundary } from '@/shared/lib/account/accountRegistry';

function Account({ name }: { name: string }) {
  useEffect(() => {
    mockEvents.push(`mount ${name}`);
    return () => {
      mockEvents.push(`unmount ${name}`);
    };
  }, [name]);
  return React.createElement('account', null, name);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function tracked<T>(promise: Promise<T>) {
  const state = { settled: false };
  void promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    }
  );
  return state;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockEvents.length = 0;
  mockFeatures.clear();
  mockNavigation.isReady.mockReturnValue(true);
  mockNavigation.getRootState.mockReturnValue({ type: 'stack', routes: [{}] });
  mockNavigation.resetRoot.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AccountSwitchBoundary', () => {
  function mount() {
    const view = render(
      <AccountSwitchBoundary>
        <Account name="account tree" />
      </AccountSwitchBoundary>
    );
    mockEvents.length = 0;
    return view;
  }

  it('registers itself while mounted and unregisters on unmount', () => {
    const view = mount();
    expect(profileSwitchBoundary()).toBeDefined();
    view.unmount();
    expect(profileSwitchBoundary()).toBeUndefined();
  });

  it('settles suspend only once the account tree has unmounted, without touching navigation', async () => {
    mount();

    let order: string[] = [];
    const suspended = profileSwitchBoundary()!
      .suspend()
      .then(() => {
        order = [...mockEvents, 'suspend settled'];
      });
    await flush();
    await suspended;

    expect(order).toEqual(['unmount account tree', 'suspend settled']);
    expect(screen.toJSON()).toBeNull();
    expect(mockNavigation.resetRoot).not.toHaveBeenCalled();
  });

  it('lets a second suspend join the first and settles at once when already suspended', async () => {
    mount();
    const boundary = profileSwitchBoundary()!;

    const both = tracked(Promise.all([boundary.suspend(), boundary.suspend()]));
    await flush();
    expect(both.settled).toBe(true);
    expect(mockEvents).toEqual(['unmount account tree']);

    const again = tracked(boundary.suspend());
    await flush();
    expect(again.settled).toBe(true);
  });

  it('closes presented sheets through a navigation reset before unmounting', async () => {
    jest.useFakeTimers();
    mount();
    mockNavigation.getRootState.mockReturnValue({
      type: 'stack',
      routes: [{}, { name: 'receive' }],
    });

    const suspended = tracked(profileSwitchBoundary()!.suspend());
    await flush();

    expect(mockNavigation.resetRoot).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: '(drawer)' }],
    });
    expect(mockEvents).toEqual([]);
    expect(suspended.settled).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    await flush();
    expect(mockEvents).toEqual(['unmount account tree']);
    expect(suspended.settled).toBe(true);
  });

  it('mounts a fresh tree on resume and resets navigation to the drawer once', async () => {
    mount();
    const boundary = profileSwitchBoundary()!;
    void boundary.suspend();
    await flush();
    mockEvents.length = 0;

    let order: string[] = [];
    const resumed = boundary.resume().then(() => {
      order = [...mockEvents, 'resume settled'];
    });
    await flush();
    await resumed;

    expect(order).toEqual(['mount account tree', 'resume settled']);
    expect(mockNavigation.resetRoot).toHaveBeenCalledTimes(1);
    expect(mockNavigation.resetRoot).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: '(drawer)' }],
    });
  });

  it('rejects resume when navigation is not ready, after the tree is back', async () => {
    mount();
    const boundary = profileSwitchBoundary()!;
    void boundary.suspend();
    await flush();
    mockEvents.length = 0;
    mockNavigation.isReady.mockReturnValue(false);

    let error: unknown;
    const resumed = boundary.resume().catch((caught: unknown) => {
      error = caught;
    });
    await flush();
    await resumed;

    expect(error).toEqual(new Error('Profile navigation is not ready'));
    expect(mockEvents).toEqual(['mount account tree']);
  });

  it('never settles a resume that has nothing to resume', async () => {
    mount();

    const resumed = tracked(profileSwitchBoundary()!.resume());
    await flush();

    // QUIRK: setting `suspended` to the value it already has commits nothing, so the
    // acknowledgement is never resolved; the switch's own timeout is what ends the wait.
    expect(resumed.settled).toBe(false);
    expect(mockEvents).toEqual([]);
    expect(mockNavigation.resetRoot).not.toHaveBeenCalled();
  });
});

describe('AccountScopedProviders', () => {
  function nesting(): string[] {
    const chain: string[] = [];
    let node = screen.toJSON() as { type: string; children?: unknown[] } | null;
    while (node && typeof node === 'object') {
      chain.push(node.type.replace('provider:', ''));
      node = (node.children?.[0] ?? null) as typeof node;
    }
    return chain;
  }

  function tree(accountIndex: number) {
    return (
      <AccountScopedProviders key={`account-${accountIndex}`} accountIndex={accountIndex}>
        <Account name="routes" />
      </AccountScopedProviders>
    );
  }

  it('nests the account providers in order with AppGate innermost, above the routes', () => {
    mockFeatures.add('nutDrop');
    mockFeatures.add('ecashMessages');
    render(tree(0));

    expect(nesting()).toEqual([
      'NostrKeys',
      'NostrNDK',
      'NostrSigner',
      'Whitenoise',
      'Coco',
      'WalletContext',
      'Colada',
      'Pricelist',
      'BitchatBLE',
      'DmEcashAutoRedeem',
      'AppGate',
      'account',
    ]);
  });

  it('leaves out BitChat and DM auto-redeem when the build has neither feature', () => {
    render(tree(0));

    expect(nesting()).toEqual([
      'NostrKeys',
      'NostrNDK',
      'NostrSigner',
      'Whitenoise',
      'Coco',
      'WalletContext',
      'Colada',
      'Pricelist',
      'AppGate',
      'account',
    ]);
  });

  it('tears down every provider and mounts a fresh set when the account key changes', () => {
    const view = render(tree(0));
    mockEvents.length = 0;

    view.rerender(tree(1));

    const unmounts = mockEvents.filter((e) => e.startsWith('unmount'));
    const mounts = mockEvents.filter((e) => e.startsWith('mount'));
    expect(unmounts).toEqual(
      expect.arrayContaining([
        'unmount NostrKeys{"defaultAccountIndex":0}',
        'unmount NostrNDK{"accountIndex":0}',
        'unmount NostrSigner',
        'unmount Whitenoise{"accountIndex":0}',
        'unmount Coco',
        'unmount WalletContext',
        'unmount Colada',
        'unmount Pricelist',
        'unmount AppGate',
        'unmount routes',
      ])
    );
    expect(unmounts).toHaveLength(10);
    expect(mounts).toEqual(
      expect.arrayContaining([
        'mount NostrKeys{"defaultAccountIndex":1}',
        'mount NostrNDK{"accountIndex":1}',
        'mount Whitenoise{"accountIndex":1}',
        'mount routes',
      ])
    );
    expect(mounts).toHaveLength(10);
    // Every old provider is gone before the first new one mounts.
    expect(mockEvents.findIndex((e) => e.startsWith('mount'))).toBe(unmounts.length);
  });

  it('keeps every provider mounted when the same account re-renders', () => {
    const view = render(tree(0));
    mockEvents.length = 0;

    view.rerender(tree(0));

    expect(mockEvents).toEqual([]);
  });
});
