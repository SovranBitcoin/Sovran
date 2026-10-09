/* eslint-disable @typescript-eslint/no-require-imports */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { defineStore, defineVanillaStore } from '@/shared/lib/persist/defineStore';
import { registerAccountScoped } from '@/shared/lib/persist/accountScoped';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';

const { collectStoreDefinitions } = require('../scripts/storeRegistryManifest.cjs') as {
  collectStoreDefinitions: (appRoot?: string) => unknown;
};

it('enumerates every app store declaration, including lazy stores and query caches', () => {
  expect(collectStoreDefinitions()).toEqual(persistRegistry.definitions);
});

it('records handles and unmodified initial state for bound and vanilla stores', () => {
  const initializer = () => ({ count: 0 });
  const bound = defineStore<{ count: number }>({ name: 'registry-test-bound', scope: 'session' })(
    initializer
  );
  const vanilla = defineVanillaStore<{ count: number }>({
    name: 'registry-test-vanilla',
    scope: 'global',
  })(initializer);
  for (const store of [bound, vanilla]) {
    const entry = persistRegistry.stores.find((candidate) => candidate.store === store);
    expect(entry?.initialState).toBe(store.getInitialState());
    expect(entry?.persisted).toBe(false);
    store.setState({ count: 7 });
    expect(entry?.initialState).toEqual({ count: 0 });
  }
});

it('records disposal without invoking it', async () => {
  const dispose = jest.fn();
  registerAccountScoped('registry-test-holder', dispose);
  expect(dispose).not.toHaveBeenCalled();
  await persistRegistry.accountScoped
    .find((holder) => holder.name === 'registry-test-holder')
    ?.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('keeps every instance when holders share a name', async () => {
  const first = jest.fn();
  const second = jest.fn();
  registerAccountScoped('registry-test-instances', first);
  registerAccountScoped('registry-test-instances', second);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  for (const holder of persistRegistry.accountScoped.filter(
    (entry) => entry.name === 'registry-test-instances'
  )) {
    await holder.dispose();
  }
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

it('rejects store imports and persisted keys omitted from registration', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'store-registry-'));
  try {
    for (const directory of ['shared', 'features', 'app']) mkdirSync(resolve(root, directory));
    const file = resolve(root, 'shared', 'newStore.ts');
    writeFileSync(
      file,
      "import { create as make } from 'zustand'; export const store = make(() => ({}));"
    );
    expect(() => collectStoreDefinitions(root)).toThrow('Unregistered store import');
    writeFileSync(file, "persistConfig({ name: 'new-persisted-key' });");
    expect(() => collectStoreDefinitions(root)).toThrow('Unregistered persisted key');
    writeFileSync(
      file,
      "import { defineStore } from '@/shared/lib/persist/defineStore'; const store = defineStore({ name: 'new-store' })(() => ({}));"
    );
    expect(() => collectStoreDefinitions(root)).toThrow('Missing name/scope');
  } finally {
    rmSync(root, { recursive: true });
  }
});
