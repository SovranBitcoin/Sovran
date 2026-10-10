/* eslint-disable @typescript-eslint/no-require-imports */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { WhitenoiseContextValue } from '@/features/whitenoise/WhitenoiseContext';
import type { persistRegistry as Registry } from '@/shared/lib/persist/persistConfig';
import type * as AccountRegistry from '@/shared/lib/account/accountRegistry';

jest.mock('@internet-privacy/marmot-ts', () => ({
  KeyPackageStore: class {},
  KeyValueGroupStateBackend: class {},
  InviteReader: class {
    removeAllListeners = jest.fn();
  },
  MarmotClient: class {
    signer;
    groups: unknown[] = [];
    removeAllListeners = jest.fn();
    constructor(options: { signer: unknown }) {
      this.signer = options.signer;
    }
  },
}));
jest.mock('@/features/whitenoise/hooks/useWhitenoiseInbox', () => ({
  useWhitenoiseInbox: () => {},
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  readSensitiveValue: jest.fn().mockResolvedValue(null),
  writeSensitiveValue: jest.fn().mockResolvedValue(undefined),
  retrieveMnemonic: jest.fn().mockResolvedValue(null),
  retrieveDerivedKeys: jest.fn().mockResolvedValue(null),
  storeMnemonic: jest.fn(),
  prepareSecureDataReset: jest.fn(),
  getMnemonic: jest.fn().mockResolvedValue(null),
  getNostrKeys: jest.fn().mockResolvedValue(null),
  getAccountKeys: jest.fn().mockResolvedValue(null),
  getPrivateKey: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({ useNostrKeysContext: jest.fn() }));
jest.mock('@/shared/providers/InitializationProvider', () => ({
  useInitializationStage: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => ({ base64: 'ACCOUNT_A_CANARY_5d71', width: 1, height: 1 }),
      }),
    })),
  },
}));
jest.mock('expo-asset', () => ({ Asset: { fromModule: () => ({ uri: 'mock-asset' }) } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn(() => true) }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { cleanup: jest.fn().mockResolvedValue(undefined), isReadyForCleanup: () => true },
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isLevelEnabled: () => false,
  };
  const logger = { ...noop, child: () => noop };
  return {
    log: logger,
    storeLog: noop,
    nostrLog: noop,
    cashuLog: noop,
    apiLog: noop,
    bitchatLog: noop,
    wnLog: noop,
    paymentLog: noop,
    aiLog: noop,
    walletLog: noop,
    initLog: jest.fn(),
    applyFileLogging: jest.fn(),
    redactError: () => 'redacted',
    monotonicNow: () => Date.now(),
  };
});

async function setup() {
  jest.resetModules();
  const storage = require('@react-native-async-storage/async-storage');
  const { useProfileStore } = require('@/shared/stores/global/profileStore');
  const { useSettingsStore } = require('@/shared/stores/global/settingsStore');
  const scoped = require('@/shared/lib/cashu/profileScopedStorage');
  const protocol = {
    ...require('@/shared/lib/profile/inProcessProfileSwitch'),
    ...require('@/shared/lib/account/accountRegistry'),
  };
  const { persistRegistry } = require('@/shared/lib/persist/persistConfig') as {
    persistRegistry: typeof Registry;
  };
  const { liveStores, declaredStores, accountHolders } =
    require('@/shared/lib/account/accountRegistry') as typeof AccountRegistry;
  const { switchToExistingProfile } = require('@/shared/lib/profile/profileSessionOrchestrator');
  const { restartApp } = require('@/shared/lib/profile/appRestart');
  const { CocoManager } = require('@/shared/lib/cashu/manager');
  const suspend = jest.fn().mockResolvedValue(undefined);
  const resume = jest.fn().mockResolvedValue(undefined);
  protocol.registerProfileSwitchBoundary({ suspend, resume });
  await storage.clear();
  await useProfileStore.persist.rehydrate();
  await useSettingsStore.persist.rehydrate();
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      { accountIndex: 0, pubkey: 'a'.repeat(64), addedAt: 1 },
      { accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 2 },
    ],
  });
  scoped.signalMigrationsComplete();
  useSettingsStore.setState({ inProcessProfileSwitch: true });
  return {
    storage,
    useProfileStore,
    useSettingsStore,
    scoped,
    protocol,
    persistRegistry,
    liveStores,
    declaredStores,
    accountHolders,
    switchToExistingProfile,
    restartApp,
    CocoManager,
    suspend,
    resume,
  };
}

afterEach(() => jest.useRealTimers());

it('loads old settings without the opt-in and tolerates an invalid field', async () => {
  const { useSettingsStore, storage } = await setup();
  const options = useSettingsStore.persist.getOptions();
  const old = options.partialize(useSettingsStore.getInitialState());
  delete old.inProcessProfileSwitch;
  old.hasSeenOnboarding = true;
  for (const state of [old, { ...old, inProcessProfileSwitch: 'invalid' }]) {
    await storage.setItem('settings-store', JSON.stringify({ state, version: options.version }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().inProcessProfileSwitch).toBe(false);
    expect(useSettingsStore.getState().hasSeenOnboarding).toBe(true);
  }
});

it.each(['disposer', 'coco', 'rehydrate'] as const)(
  '%s failure restarts with no partial B session',
  async (failure) => {
    jest.useFakeTimers();
    const env = await setup();
    if (failure === 'disposer')
      env.accountHolders.push({
        name: 'failing',
        dispose: () => {
          throw new Error('fail');
        },
      });
    if (failure === 'coco') env.CocoManager.cleanup.mockReturnValue(new Promise(() => {}));
    if (failure === 'rehydrate') {
      const { useThemeStore } = require('@/shared/stores/profile/themeStore');
      jest.spyOn(useThemeStore.persist, 'rehydrate').mockRejectedValue(new Error('fail'));
    }
    const pending = env.switchToExistingProfile({ accountIndex: 1 });
    // One step timeout, then the bounded wait for the wallet database to close
    // that precedes every restart. A cleanup that never resolves spends both.
    await jest.advanceTimersByTimeAsync(11_000);
    expect(await pending).toBe(true);
    expect(env.restartApp).toHaveBeenCalledTimes(1);
    expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(env.resume).not.toHaveBeenCalled();
    expect(JSON.parse(await env.storage.getItem('profile-store')).state.activeAccountIndex).toBe(1);
  }
);

it('drains admitted writes to A and suppresses writes while switching', async () => {
  const env = await setup();
  await env.useProfileStore.persist.rehydrate();
  const adapter = env.scoped.createProfileScopedStorage();
  const write = adapter.setItem('drain-canary', 'A');
  const block = env.scoped.blockProfilePersistWrites();
  env.useProfileStore.setState({ activeAccountIndex: 1 });
  await Promise.all([write, block]);
  await adapter.setItem('drain-canary', 'blocked');
  expect(await env.storage.getItem(`drain-canary:profile:${'a'.repeat(64)}`)).toBe('A');
  expect(await env.storage.getItem(`drain-canary:profile:${'b'.repeat(64)}`)).toBeNull();
});

it('canary resets every registered profile/session store and invokes every reachable holder', async () => {
  const env = await setup();
  for (const file of new Set(
    env.declaredStores.filter((entry) => entry.scope !== 'global').map((entry) => entry.file)
  )) {
    require(`../${file.replace(/\.tsx?$/, '')}`);
  }
  function loadHolderModules(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) loadHolderModules(path);
      else if (
        /\.tsx?$/.test(path) &&
        !/\.test\./.test(path) &&
        /registerAccountScoped\(/.test(readFileSync(path, 'utf8'))
      )
        require(path);
    }
  }
  loadHolderModules(join(__dirname, '../shared'));
  loadHolderModules(join(__dirname, '../features'));
  // Import registrations without creating a manager or opening any native database.
  jest.requireActual('@/shared/lib/cashu/manager');
  // Owner-bound budget instances are tested separately without mutating the schema canary.
  const entries = env.liveStores.filter((entry) => entry.scope !== 'global');
  const sentinel = 'ACCOUNT_A_CANARY_5d71';
  const attachments = require('@/features/ai/lib/attachments');
  const image = { localUri: sentinel, mimeType: 'image/jpeg', width: 1, height: 1 };
  expect(await attachments.encodeChatImage(image)).toContain(sentinel);
  const errors = require('@/features/ai/lib/turnErrors');
  const truncations = require('@/features/ai/lib/turnTruncation');
  errors.recordTurnError(sentinel, { id: 'unknown', text: sentinel });
  truncations.recordTurnTruncation(sentinel, { budgetTokens: 42 });
  const availability = require('@/features/ai/lib/modelAvailability');
  availability.markModelUnavailable('https://example.invalid', sentinel, { status: 404 });
  const zaps = require('@/shared/stores/runtime/pendingZapStore');
  zaps.registerPendingZap({
    meltTarget: sentinel,
    eventId: sentinel,
    eventKind: 1,
    authorPubkey: sentinel,
    contentPreview: sentinel,
    emoji: sentinel,
    comment: sentinel,
    createdAt: Date.now(),
  });
  const { nip04Cache } = require('@/shared/lib/nostr/nip04Cache');
  nip04Cache.put('a'.repeat(64), sentinel, sentinel);
  const { giftWrapCache } = require('@/shared/lib/nostr/giftWrapCache');
  giftWrapCache.cache.put('a'.repeat(64), sentinel, { senderPubkey: sentinel });
  await env.useProfileStore.persist.rehydrate();
  for (const entry of entries) {
    if (entry.store.persist) await entry.store.persist.rehydrate();
  }
  const originals = new Map<string, string>();
  for (const entry of entries) {
    const state = {
      ...Object(entry.store.getState()),
      __profileSwitchCanary: sentinel,
    };
    // Preserve container shapes: projections can inspect rows before the storage gate.
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'string') state[key] = sentinel;
    }
    env.scoped.withSkippedPersistWrites(() => entry.store.setState(state as never, true));
    if (entry.persisted) {
      const config = env.persistRegistry.find((config) => config.name === entry.name)!;
      const key = `${entry.name}:profile:${'a'.repeat(64)}`;
      const blob = JSON.stringify({
        state: {
          ...Object(config.partialize(entry.store.getState() as never)),
          __profileSwitchCanary: sentinel,
        },
        version: config.version,
      });
      await env.storage.setItem(key, blob);
      originals.set(key, blob);
    }
  }
  const theme = require('@/shared/stores/profile/themeStore').useThemeStore;
  await env.storage.setItem(
    `theme-store:profile:${'b'.repeat(64)}`,
    JSON.stringify({
      state: { activeAlbumSlug: null, unitWallpapers: {}, mode: 'light' },
      version: 2,
    })
  );
  const uninspectable: Record<string, string> = {
    'cache.session-epoch':
      'A monotonic generation, not an account-data holder; disposal is observed.',
    'nostr.for-you-cache': 'Package-private Map; nostr package edits are excluded from this task.',
    'wallet.reusable-quote-flights': 'Package-private flights; wallet package edits are excluded.',
    'wallet.melt-target': 'Wallet closure; manager and wallet edits are excluded.',
    'wallet.cashu-seed': 'Manager-private seed; manager edits are excluded.',
  };
  const holders = [...env.accountHolders];
  for (const holder of holders) {
    expect(Boolean(holder.inspect) || Boolean(uninspectable[holder.name])).toBe(true);
  }
  expect(
    holders
      .filter((holder) => !holder.inspect)
      .map((holder) => holder.name)
      .sort()
  ).toEqual(Object.keys(uninspectable).sort());
  const holderCanaries = new Set(env.accountHolders);
  for (const holder of holderCanaries) {
    const dispose = holder.dispose;
    holder.dispose = async () => {
      await dispose();
      holderCanaries.delete(holder);
    };
  }
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).not.toHaveBeenCalled();
  expect(env.resume).toHaveBeenCalledTimes(1);
  expect(holderCanaries.size).toBe(0);
  for (const holder of holders) if (holder.inspect) expect(holder.inspect()).toBe(true);
  require('expo-image-manipulator').ImageManipulator.manipulate.mockReturnValue({
    renderAsync: async () => ({
      saveAsync: async () => ({ base64: 'ACCOUNT_B', width: 1, height: 1 }),
    }),
  });
  expect(await attachments.encodeChatImage(image)).toBe('data:image/jpeg;base64,ACCOUNT_B');
  expect(availability.isModelUnavailable('https://example.invalid', sentinel)).toBe(false);
  expect(zaps.peekPendingZap(sentinel)).toBeUndefined();
  expect(nip04Cache.get('a'.repeat(64), sentinel)).toBeUndefined();
  expect(errors.getTurnError(sentinel)).toBeNull();
  expect(truncations.getTurnTruncation(sentinel)).toBeNull();
  expect(giftWrapCache.cache.get('a'.repeat(64), sentinel)).toBeUndefined();
  expect(theme.getState().mode).toBe('light');
  process.stdout.write(
    JSON.stringify({
      stores: entries.length,
      holders: env.accountHolders.length,
      seededHolders: 7,
      inspectedHolders: holders.filter((holder) => holder.inspect).length,
      inspectedNames: holders.filter((holder) => holder.inspect).map((holder) => holder.name),
      uninspectable: Object.keys(uninspectable),
    }) + '\n'
  );
  for (const entry of entries) {
    expect(JSON.stringify(entry.store.getState())).not.toContain(sentinel);
    entry.store.setState(entry.store.getState() as never, true);
  }
  await env.scoped.blockProfilePersistWrites();
  for (const [key, value] of originals) expect(await env.storage.getItem(key)).toBe(value);
  for (const key of await env.storage.getAllKeys()) {
    if (key.endsWith(`:profile:${'b'.repeat(64)}`))
      expect(await env.storage.getItem(key)).not.toContain(sentinel);
  }
  expect(entries.length).toBeGreaterThan(40);
});

it('refuses captured storage without a registered disposal and restarts', async () => {
  const env = await setup();
  const { createVertexBudgetStore } = require('@/shared/stores/profile/vertexBudgetStore');
  createVertexBudgetStore('a'.repeat(64));
  const captured = env.persistRegistry.find((entry) => entry.name === 'vertex-budget-store');
  if (!captured) throw new Error('Missing budget registration');
  env.persistRegistry.push({ ...captured, store: undefined, name: 'unsupported-owner' });
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).toHaveBeenCalledTimes(1);
  expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
  expect(env.resume).not.toHaveBeenCalled();
});

it('treats a swallowed storage rejection as failed hydration', async () => {
  const env = await setup();
  require('@/shared/stores/profile/themeStore');
  const getItem = env.storage.getItem.getMockImplementation();
  env.storage.getItem.mockImplementation((key: string) => {
    if (key === `theme-store:profile:${'b'.repeat(64)}`)
      return Promise.reject(new Error('storage unavailable'));
    return getItem(key);
  });
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).toHaveBeenCalledTimes(1);
  expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
  expect(env.resume).not.toHaveBeenCalled();
});

it('keeps writes and providers held when the fallback restart is unavailable', async () => {
  const env = await setup();
  env.restartApp.mockReturnValue(false);
  env.protocol.registerProfileSwitchService('unsafe-service', () => {
    throw new Error('no teardown');
  });
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(false);
  expect(env.resume).not.toHaveBeenCalled();
  await env.scoped.createProfileScopedStorage().setItem('held-canary', 'must not write');
  expect(await env.storage.getItem(`held-canary:profile:${'a'.repeat(64)}`)).toBeNull();
});

it('reports leak locations without logging payloads', async () => {
  const env = await setup();
  const { useThemeStore } = require('@/shared/stores/profile/themeStore');
  await useThemeStore.persist.rehydrate();
  const previous = 'a'.repeat(64);
  const payload = `message-content-must-not-log-${previous}`;
  env.scoped.withSkippedPersistWrites(() =>
    useThemeStore.setState({ unitWallpapers: { sat: payload } })
  );
  await env.storage.setItem('leak-fixture', payload);
  const { log } = require('@/shared/lib/logger');
  log.warn.mockClear();
  await env.protocol.checkProfileSwitchLeaks(previous);
  expect(log.warn).toHaveBeenCalledWith('profile.switch.leak', { store: 'theme-store' });
  expect(log.warn).toHaveBeenCalledWith('profile.switch.leak', { key: 'leak-fixture' });
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain(payload);
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain(previous);
});

it('NDK provider unmount stops subscriptions, disconnects relays and drops the signer', async () => {
  await setup();
  const React = require('react');
  const renderer = require('react-test-renderer');
  const mobile = require('@nostr-dev-kit/ndk-mobile');
  const keys = require('@/shared/providers/NostrKeysProvider');
  const initialization = require('@/shared/providers/InitializationProvider');
  const logger = require('@/shared/lib/logger');
  logger.useInitMount = jest.fn();
  initialization.useInitializationStage.mockReturnValue({ canStart: false });
  keys.useNostrKeysContext.mockReturnValue({ keys: null });
  const stop = jest.fn();
  const disconnect = jest.fn();
  const ndk = {
    signer: { account: 'A' },
    removeAllListeners: jest.fn(),
    pool: { relays: new Map([['relay', { disconnect }]]) },
    subManager: { subscriptions: new Map([['subscription', { stop }]]) },
  };
  const spy = jest.spyOn(mobile, 'useNDK').mockReturnValue({ ndk, init: jest.fn() });
  const { NostrNDKProvider } = require('@/shared/providers/NostrNDKProvider');
  let tree: ReturnType<typeof renderer.create>;
  try {
    await renderer.act(async () => {
      tree = renderer.create(React.createElement(NostrNDKProvider, { accountIndex: 0 }, null));
    });
    await renderer.act(async () => {
      tree.unmount();
    });
    expect(stop).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(ndk.signer).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it('does not merge a late account-A hydration into an empty account B', async () => {
  const env = await setup();
  const getItem = env.storage.getItem.getMockImplementation();
  let resolveOld: (blob: string) => void = () => {};
  const oldRead = new Promise<string>((resolve) => {
    resolveOld = resolve;
  });
  env.storage.getItem.mockImplementation(async (key: string) => {
    if (key === `theme-store:profile:${'a'.repeat(64)}`) return oldRead;
    if (key === `mint-store:profile:${'b'.repeat(64)}`) {
      for (let turn = 0; turn < 10; turn++) await Promise.resolve();
      return null;
    }
    return getItem(key);
  });
  require('@/shared/stores/profile/mintStore');
  const { useThemeStore } = require('@/shared/stores/profile/themeStore');
  const unsubscribe = env.useProfileStore.subscribe((state: { activeAccountIndex: number }) => {
    if (state.activeAccountIndex === 1)
      resolveOld(
        JSON.stringify({
          state: { activeAlbumSlug: 'ACCOUNT_A_CANARY', unitWallpapers: {}, mode: 'dark' },
          version: 2,
        })
      );
  });
  try {
    expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
    expect(env.restartApp).not.toHaveBeenCalled();
    expect(useThemeStore.getState().activeAlbumSlug).toBeNull();
  } finally {
    unsubscribe();
  }
});

it('strict Coco cleanup rejects swallowed teardown failures while default cleanup stays best-effort', async () => {
  await setup();
  const { CocoManager } = jest.requireActual('@/shared/lib/cashu/manager');
  const dispose = jest.fn().mockResolvedValue(undefined);
  const instance = {
    disableProofStateWatcher: jest.fn().mockRejectedValue(new Error('watcher teardown failed')),
    disableMintOperationProcessor: jest.fn().mockResolvedValue(undefined),
    disableMintOperationWatcher: jest.fn().mockResolvedValue(undefined),
    disableMeltSettlementProcessor: jest.fn().mockResolvedValue(undefined),
    disableMeltQuoteWatcher: jest.fn().mockResolvedValue(undefined),
    dispose,
  };
  // Synthetic manager only: no native database, proofs, wallet or network.
  Reflect.set(CocoManager, 'instance', instance);
  await expect(CocoManager.cleanup({ requireSuccess: true })).rejects.toThrow(
    'Coco teardown incomplete'
  );
  expect(dispose).toHaveBeenCalledTimes(1);
  Reflect.set(CocoManager, 'instance', instance);
  await expect(CocoManager.cleanup()).resolves.toBeUndefined();
  expect(dispose).toHaveBeenCalledTimes(2);
  Reflect.set(CocoManager, 'instance', instance);
  const defaultPending = CocoManager.cleanup();
  const joinedAssertion = expect(CocoManager.cleanup({ requireSuccess: true })).rejects.toThrow(
    'Coco teardown incomplete'
  );
  await expect(defaultPending).resolves.toBeUndefined();
  await joinedAssertion;
  expect(dispose).toHaveBeenCalledTimes(3);
});

it('restarts without exposing account B when persisting the active index fails', async () => {
  const env = await setup();
  const setItem = env.storage.setItem.getMockImplementation();
  env.storage.setItem.mockImplementation((key: string, value: string) => {
    if (key === 'profile-store') return Promise.reject(new Error('write failed'));
    return setItem(key, value);
  });
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).toHaveBeenCalledTimes(1);
  expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
  expect(env.resume).not.toHaveBeenCalled();
});

it('flushes and unregisters Vertex instances without allowing retained handles to write as B', async () => {
  const env = await setup();
  const {
    createVertexBudgetStore,
    getVertexBudgetStore,
  } = require('@/shared/stores/profile/vertexBudgetStore');
  const stores = [createVertexBudgetStore('a'.repeat(64)), getVertexBudgetStore('a'.repeat(64))];
  await Promise.all(stores.map((store) => store.persist.rehydrate()));
  stores[0].getState().reserve();
  expect(env.scoped.hasCapturedProfileStorage()).toBe(true);
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).not.toHaveBeenCalled();
  expect(env.scoped.hasCapturedProfileStorage()).toBe(false);
  expect(env.liveStores.some((entry) => entry.name === 'vertex-budget-store')).toBe(false);
  expect(
    JSON.parse(await env.storage.getItem(`vertex-budget-store:profile:${'a'.repeat(64)}`)).state
      .used
  ).toBe(1);
  for (const store of stores) {
    expect(store.getState().reserve()).toBe(false);
    store.setState({ used: 10 });
  }
  expect(await env.storage.getItem(`vertex-budget-store:profile:${'b'.repeat(64)}`)).toBeNull();
});

it('persists a final teardown write under A before raising the reset barrier', async () => {
  const env = await setup();
  const { useThemeStore } = require('@/shared/stores/profile/themeStore');
  await useThemeStore.persist.rehydrate();
  env.CocoManager.cleanup.mockImplementation(async () => {
    useThemeStore.setState({ activeAlbumSlug: 'final-A-write' });
  });
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).not.toHaveBeenCalled();
  expect(
    JSON.parse(await env.storage.getItem(`theme-store:profile:${'a'.repeat(64)}`)).state
      .activeAlbumSlug
  ).toBe('final-A-write');
  expect(useThemeStore.getState().activeAlbumSlug).toBeNull();
  expect(await env.storage.getItem(`theme-store:profile:${'b'.repeat(64)}`)).toBeNull();
});

it('replaces the old NDK/cache through public init before exposing B', async () => {
  const env = await setup();
  const React = require('react');
  const renderer = require('react-test-renderer');
  const mobile = require('@nostr-dev-kit/ndk-mobile');
  require('@/shared/lib/logger').useInitMount = jest.fn();
  require('@/shared/providers/InitializationProvider').useInitializationStage.mockReturnValue({
    canStart: false,
  });
  require('@/shared/providers/NostrKeysProvider').useNostrKeysContext.mockReturnValue({
    keys: null,
  });
  const old = {
    cacheAdapter: { database: 'A' },
    signer: {},
    removeAllListeners: jest.fn(),
    subManager: { subscriptions: new Map() },
    pool: { relays: new Map() },
    outboxPool: { relays: new Map([['outbox', { disconnect: jest.fn() }]]) },
  };
  let current = old;
  const init = jest.fn((params) => {
    current = { ...params };
  });
  const logout = jest.fn();
  const spy = jest
    .spyOn(mobile, 'useNDK')
    .mockImplementation(() => ({ ndk: current, init, logout }));
  const { NostrNDKProvider } = require('@/shared/providers/NostrNDKProvider');
  let tree: ReturnType<typeof renderer.create>;
  try {
    await renderer.act(async () => {
      tree = renderer.create(React.createElement(NostrNDKProvider, { accountIndex: 0 }, null));
    });
    await env.protocol.profileSwitchServices().get('nostr.ndk')();
    const holder = env.accountHolders.find((entry) => entry.name === 'nostr.ndk:0');
    await renderer.act(async () => {
      tree.unmount();
    });
    await holder?.dispose();
    expect(mobile.useNDK().ndk).not.toBe(old);
    expect(mobile.useNDK().ndk.cacheAdapter).not.toBe(old.cacheAdapter);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ explicitRelayUrls: [] }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(old.outboxPool.relays.get('outbox')?.disconnect).toHaveBeenCalled();
  } finally {
    await renderer.act(async () => {
      tree?.unmount();
    });
    spy.mockRestore();
  }
});

it('completes the fast path with an active idle Routstr SDK client and scheduled recovery', async () => {
  const env = await setup();
  const sdk = require('@/shared/lib/routstr/sdk/client');
  const bound = await sdk.getRoutstrClient('https://example.invalid');
  sdk.scheduleRecoverySweeps();
  expect(bound.client.getCashuSpender()).toBeDefined();
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).not.toHaveBeenCalled();
  expect(() => bound.client.getCashuSpender()).toThrow();
  expect(env.accountHolders.find((holder) => holder.name === 'routstr.client')?.inspect?.()).toBe(
    true
  );
});

it('completes the fast path with an active Whitenoise client and zeroes its signer', async () => {
  const env = await setup();
  const stop = jest.fn().mockResolvedValue(undefined);
  jest.doMock('@/features/whitenoise/client/network', () => ({
    createWhitenoiseNetwork: () => ({ shutdown: stop }),
  }));
  jest.doMock('@internet-privacy/marmot-ts', () => ({
    KeyPackageStore: class {},
    KeyValueGroupStateBackend: class {},
    MarmotClient: class {
      signer;
      groups = [];
      removeAllListeners = jest.fn();
      constructor(options: { signer: unknown }) {
        this.signer = options.signer;
      }
    },
  }));
  const { createWhitenoiseClient } = require('@/features/whitenoise/client');
  const handle = createWhitenoiseClient({
    accountIndex: 0,
    privateKey: new Uint8Array(32).fill(1),
    ndk: {},
    fallbackRelays: [],
  });
  const signer = handle.client.signer;
  env.protocol.registerProfileSwitchService('whitenoise', handle.shutdown);
  env.accountHolders.push({ name: 'whitenoise.client', dispose: handle.release });
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(() => signer.signEvent({ kind: 1, content: '', tags: [], created_at: 0 })).toThrow(
    'disposed'
  );
  expect(() => handle.client.groups).toThrow();
});

it('refuses only Whitenoise loaded MLS state that Marmot cannot release non-destructively', async () => {
  const env = await setup();
  const { createWhitenoiseClient } = require('@/features/whitenoise/client');
  const handle = createWhitenoiseClient({
    accountIndex: 0,
    privateKey: new Uint8Array(32).fill(1),
    ndk: {},
    fallbackRelays: [],
  });
  handle.client.groups.push({ state: 'private MLS state' });
  env.protocol.registerProfileSwitchService('whitenoise', handle.shutdown);
  expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  expect(env.restartApp).toHaveBeenCalledTimes(1);
  expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
  expect(env.resume).not.toHaveBeenCalled();
});

it('refuses only an armed SDK refund interval missing its release hook', async () => {
  const env = await setup();
  const bound = await require('@/shared/lib/routstr/sdk/client').getRoutstrClient(
    'https://example.invalid'
  );
  const sdk = require('@routstr/sdk/browser');
  const spy = jest
    .spyOn(sdk.RoutstrClient.prototype, 'getCashuSpender')
    .mockReturnValue({ _refundRetryInterval: 1 });
  try {
    expect(bound.client).toBeDefined();
    expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
    expect(env.restartApp).toHaveBeenCalledTimes(1);
    expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(env.resume).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('registers the live Whitenoise provider for awaited switch disposal', async () => {
  const env = await setup();
  jest.doMock('@internet-privacy/marmot-ts', () => ({
    KeyPackageStore: class {},
    KeyValueGroupStateBackend: class {},
    InviteReader: class {
      removeAllListeners = jest.fn();
    },
    MarmotClient: class {
      signer;
      groups = [];
      removeAllListeners = jest.fn();
      constructor(options: { signer: unknown }) {
        this.signer = options.signer;
      }
    },
  }));
  const React = require('react');
  const renderer = require('react-test-renderer');
  const mobile = require('@nostr-dev-kit/ndk-mobile');
  require('@/shared/providers/NostrKeysProvider').useNostrKeysContext.mockReturnValue({
    keys: { privateKey: new Uint8Array(32).fill(1) },
  });
  const spy = jest.spyOn(mobile, 'useNDK').mockReturnValue({ ndk: {} });
  const { WhitenoiseProvider } = require('@/features/whitenoise/WhitenoiseProvider');
  const { WhitenoiseContext } = require('@/features/whitenoise/WhitenoiseContext');
  let client;
  let tree: ReturnType<typeof renderer.create>;
  try {
    await renderer.act(async () => {
      tree = renderer.create(
        React.createElement(
          WhitenoiseProvider,
          { accountIndex: 0 },
          React.createElement(WhitenoiseContext.Consumer, null, (value: WhitenoiseContextValue) => {
            client = value.client;
            return null;
          })
        )
      );
    });
    expect(client).toBeDefined();
    expect(client).not.toBeNull();
    const holder = env.accountHolders.find((entry) => entry.name === 'whitenoise.client');
    expect(holder?.inspect?.()).toBe(false);
    expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
    expect(env.restartApp).not.toHaveBeenCalled();
    expect(holder?.inspect?.()).toBe(true);
  } finally {
    await renderer.act(async () => {
      tree?.unmount();
    });
    spy.mockRestore();
  }
});

it('awaits SDK stream finalization before allowing B to mount', async () => {
  const env = await setup();
  const sdk = require('@routstr/sdk/browser');
  let finish: () => void = () => {};
  const work = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const finalize = jest.fn(() => work);
  const spy = jest
    .spyOn(sdk.RoutstrClient.prototype, 'routeRequest')
    .mockResolvedValue({ finalize });
  try {
    const bound = await require('@/shared/lib/routstr/sdk/client').getRoutstrClient(
      'https://example.invalid'
    );
    const response = await bound.client.routeRequest({});
    const pending = env.switchToExistingProfile({ accountIndex: 1 });
    const settlement = response.finalize();
    await Promise.resolve();
    expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(env.resume).not.toHaveBeenCalled();
    finish();
    await settlement;
    expect(env.resume).not.toHaveBeenCalled();
    await bound.finish();
    expect(await pending).toBe(true);
    expect(env.restartApp).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('stops the installed SDK refund timer hook and awaits its running refund', async () => {
  const env = await setup();
  const sdk = require('@routstr/sdk/browser');
  let refundComplete: () => void = () => {};
  const refund = new Promise<void>((resolve) => {
    refundComplete = resolve;
  });
  const spender = {
    _refundRetryInterval: 1,
    _stopRefundRetryInterval: jest.fn(() => {
      spender._refundRetryInterval = 0;
    }),
    refundXcashuTokens: jest.fn(() => refund),
  };
  const spy = jest.spyOn(sdk.RoutstrClient.prototype, 'getCashuSpender').mockReturnValue(spender);
  try {
    const bound = await require('@/shared/lib/routstr/sdk/client').getRoutstrClient(
      'https://example.invalid'
    );
    const active = bound.client.getCashuSpender().refundXcashuTokens();
    const pending = env.switchToExistingProfile({ accountIndex: 1 });
    for (let turn = 0; turn < 15; turn++) await Promise.resolve();
    expect(env.useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(env.resume).not.toHaveBeenCalled();
    refundComplete();
    await active;
    expect(await pending).toBe(true);
    expect(spender._stopRefundRetryInterval).toHaveBeenCalledTimes(1);
    expect(env.restartApp).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('disposes an NDK initialized after quiescence has taken the service snapshot', async () => {
  const env = await setup();
  const React = require('react');
  const renderer = require('react-test-renderer');
  const mobile = require('@nostr-dev-kit/ndk-mobile');
  require('@/shared/lib/logger').useInitMount = jest.fn();
  require('@/shared/providers/InitializationProvider').useInitializationStage.mockReturnValue({
    canStart: false,
  });
  require('@/shared/providers/NostrKeysProvider').useNostrKeysContext.mockReturnValue({
    keys: null,
  });
  const old = {
    cacheAdapter: { database: 'A' },
    signer: {},
    removeAllListeners: jest.fn(),
    subManager: { subscriptions: new Map() },
    pool: { relays: new Map() },
    outboxPool: { relays: new Map([['relay', { disconnect: jest.fn() }]]) },
  };
  let current = old;
  const init = jest.fn((params) => {
    current = { ...params };
  });
  const spy = jest
    .spyOn(mobile, 'useNDK')
    .mockImplementation(() => ({ ndk: current, init, logout: jest.fn() }));
  const { NostrNDKProvider } = require('@/shared/providers/NostrNDKProvider');
  let tree: ReturnType<typeof renderer.create>;
  env.protocol.registerProfileSwitchService('deferred-provider', async () => {
    await renderer.act(async () => {
      tree = renderer.create(React.createElement(NostrNDKProvider, { accountIndex: 0 }, null));
    });
  });
  env.suspend.mockImplementation(async () => {
    await renderer.act(async () => {
      tree.unmount();
    });
  });
  try {
    expect(await env.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
    expect(env.restartApp).not.toHaveBeenCalled();
    expect(current).not.toBe(old);
    expect(old.cacheAdapter).toBeUndefined();
    expect(old.outboxPool.relays.get('relay')?.disconnect).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
