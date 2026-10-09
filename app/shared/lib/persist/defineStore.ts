import { create, type StateCreator, type StoreApi, type StoreMutatorIdentifier } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { persistRegistry, type StoreScope } from './persistConfig';

interface StoreDefinition {
  name: string;
  scope: StoreScope;
}

function record<T>(definition: StoreDefinition, store: StoreApi<T>): void {
  const registration = {
    ...definition,
    persisted: 'persist' in store,
    store,
    initialState: store.getInitialState(),
  };
  persistRegistry.stores.push(registration);
  for (const entry of persistRegistry) {
    if (entry.name === definition.name) Object.assign(entry, registration);
  }
}

/** The initializer and middleware are passed through unchanged. */
export function defineStore<T>(definition: StoreDefinition) {
  return <Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>
  ) => {
    const store = create<T>()(initializer);
    record(definition, store);
    return store;
  };
}

/** Captured-owner stores use the same registry without adding a React hook. */
export function defineVanillaStore<T>(definition: StoreDefinition) {
  return <Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>
  ) => {
    const store = createStore<T>()(initializer);
    record(definition, store);
    return store;
  };
}
