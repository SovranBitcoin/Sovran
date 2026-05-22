/* eslint-disable import/first */

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  redactError: (error: unknown) => error,
  storeLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  log: {
    warn: jest.fn(),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_AVATAR_FALLBACK_VARIANT,
  type AvatarFallbackVariant,
} from '@/shared/lib/avatarFallback';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

const storage = AsyncStorage as unknown as {
  clear: () => Promise<void>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

async function setPersistedSettings(state: Record<string, unknown>) {
  await storage.setItem(
    'settings-store',
    JSON.stringify({
      state,
      version: 1,
    })
  );
}

describe('settings avatar fallback variant', () => {
  beforeEach(async () => {
    await storage.clear();
    useSettingsStore.setState({
      avatarFallbackVariant: DEFAULT_AVATAR_FALLBACK_VARIANT,
      mockMode: false,
    });
  });

  it('defaults to beam on fresh installs', () => {
    expect(useSettingsStore.getState().avatarFallbackVariant).toBe('beam');
    expect(useSettingsStore.getState().getAvatarFallbackVariant()).toBe('beam');
  });

  it('stores allowed variants through the settings action', () => {
    useSettingsStore.getState().setAvatarFallbackVariant('glass');
    expect(useSettingsStore.getState().avatarFallbackVariant).toBe('glass');
  });

  it('hydrates an allowed persisted variant', async () => {
    await setPersistedSettings({
      avatarFallbackVariant: 'glass' satisfies AvatarFallbackVariant,
    });

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().avatarFallbackVariant).toBe('glass');
  });

  it('rejects an invalid persisted variant and keeps the default', async () => {
    await setPersistedSettings({ avatarFallbackVariant: 'ring' });

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().avatarFallbackVariant).toBe('beam');
  });
});
