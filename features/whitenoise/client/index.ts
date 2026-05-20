import {
  KeyPackageStore,
  MarmotClient,
  type NostrNetworkInterface,
} from '@internet-privacy/marmot-ts';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { createWhitenoiseStorage } from '../storage';
import {
  createWhitenoiseGroupHistoryFactory,
  WhitenoiseGroupHistory,
} from '../storage/groupHistory';
import { createWhitenoiseNetwork } from './network';
import { createWhitenoiseSigner } from './signer';

type WhitenoiseClientOptions = {
  accountIndex: number;
  privateKey: Uint8Array;
  ndk: NDK;
  fallbackRelays: readonly string[];
};

type WhitenoiseClientHandle = {
  client: MarmotClient<WhitenoiseGroupHistory>;
  disposeSigner: () => void;
};

export function createWhitenoiseClient(opts: WhitenoiseClientOptions): WhitenoiseClientHandle {
  const { groupStateBackend, keyPackageStoreBackend } = createWhitenoiseStorage(opts.accountIndex);
  const keyPackageStore = new KeyPackageStore(keyPackageStoreBackend);
  const signer = createWhitenoiseSigner(opts.privateKey);
  const network: NostrNetworkInterface = createWhitenoiseNetwork(opts.ndk, opts.fallbackRelays);
  const client = new MarmotClient<WhitenoiseGroupHistory>({
    signer,
    groupStateBackend,
    keyPackageStore,
    network,
    historyFactory: createWhitenoiseGroupHistoryFactory(opts.accountIndex),
  });
  return { client, disposeSigner: signer.dispose };
}
