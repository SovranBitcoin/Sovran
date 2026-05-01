import {
  KeyValueGroupStateBackend,
  type GroupStateStoreBackend,
  type KeyPackageStoreBackend,
  type SerializedClientState,
  type StoredKeyPackage,
} from '@internet-privacy/marmot-ts';
import { AsyncStorageKVBackend } from './asyncStorageBackend';

export type WhitenoiseStorage = {
  groupStateBackend: GroupStateStoreBackend;
  keyPackageStoreBackend: KeyPackageStoreBackend;
};

function namespace(accountIndex: number, kind: 'group-state' | 'key-package'): string {
  return `whitenoise:${accountIndex}:${kind}`;
}

export function createWhitenoiseStorage(accountIndex: number): WhitenoiseStorage {
  const groupStateKv = new AsyncStorageKVBackend<SerializedClientState>(
    namespace(accountIndex, 'group-state')
  );
  const keyPackageStoreBackend = new AsyncStorageKVBackend<StoredKeyPackage>(
    namespace(accountIndex, 'key-package')
  );
  const groupStateBackend = new KeyValueGroupStateBackend(groupStateKv);
  return { groupStateBackend, keyPackageStoreBackend };
}

export { WHITENOISE_STORAGE_VERSION } from './asyncStorageBackend';
export {
  wipeWhitenoiseStorage,
  wipeWhitenoiseStorageForAccounts,
} from './cleanup';
