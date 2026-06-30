import {
  KeyValueGroupStateBackend,
  type GroupStateStoreBackend,
  type KeyPackageStoreBackend,
  type SerializedClientState,
  type StoredKeyPackage,
} from '@internet-privacy/marmot-ts';
import { AsyncStorageKVBackend } from './asyncStorageBackend';
import { WhitenoiseNamespace, whitenoisePrefix } from './namespaces';

type WhitenoiseStorage = {
  groupStateBackend: GroupStateStoreBackend;
  keyPackageStoreBackend: KeyPackageStoreBackend;
};

export function createWhitenoiseStorage(accountIndex: number): WhitenoiseStorage {
  const groupStateKv = new AsyncStorageKVBackend<SerializedClientState>(
    whitenoisePrefix(accountIndex, WhitenoiseNamespace.GroupState)
  );
  const keyPackageStoreBackend = new AsyncStorageKVBackend<StoredKeyPackage>(
    whitenoisePrefix(accountIndex, WhitenoiseNamespace.KeyPackage)
  );
  const groupStateBackend = new KeyValueGroupStateBackend(groupStateKv);
  return { groupStateBackend, keyPackageStoreBackend };
}

export { wipeWhitenoiseStorageForAccounts } from './cleanup';
