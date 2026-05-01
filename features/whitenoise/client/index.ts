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

// Pull `EventSigner` shape out of MarmotClient's constructor options without
// importing it from an applesauce subpath that marmot-ts doesn't re-export.
type MarmotSigner = ConstructorParameters<typeof MarmotClient>[0]['signer'];

export type WhitenoiseClientOptions = {
  accountIndex: number;
  privateKey: Uint8Array;
  ndk: NDK;
  fallbackRelays: readonly string[];
};

export function createWhitenoiseClient(
  opts: WhitenoiseClientOptions
): MarmotClient<WhitenoiseGroupHistory> {
  const { groupStateBackend, keyPackageStoreBackend } = createWhitenoiseStorage(opts.accountIndex);
  const keyPackageStore = new KeyPackageStore(keyPackageStoreBackend);
  const signer = createWhitenoiseSigner(opts.privateKey) as unknown as MarmotSigner;
  const network: NostrNetworkInterface = createWhitenoiseNetwork(opts.ndk, opts.fallbackRelays);
  return new MarmotClient<WhitenoiseGroupHistory>({
    signer,
    groupStateBackend,
    keyPackageStore,
    network,
    historyFactory: createWhitenoiseGroupHistoryFactory(opts.accountIndex),
  });
}

export { createWhitenoiseNetwork } from './network';
export { createWhitenoiseSigner } from './signer';
