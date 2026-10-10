import { profileSwitchResource } from '@/shared/lib/profile/profileSwitchResource';
import { KeyPackageStore, MarmotClient } from '@internet-privacy/marmot-ts';
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
  shutdown: () => Promise<void>;
  release: () => void;
};

export function createWhitenoiseClient(opts: WhitenoiseClientOptions): WhitenoiseClientHandle {
  const { groupStateBackend, keyPackageStoreBackend } = createWhitenoiseStorage(opts.accountIndex);
  const keyPackageStore = new KeyPackageStore(keyPackageStoreBackend);
  const signer = createWhitenoiseSigner(opts.privateKey);
  const network = createWhitenoiseNetwork(opts.ndk, opts.fallbackRelays);
  const client = new MarmotClient<WhitenoiseGroupHistory>({
    signer,
    groupStateBackend,
    keyPackageStore,
    network,
    historyFactory: createWhitenoiseGroupHistoryFactory(opts.accountIndex),
  });
  const resource = profileSwitchResource(client, ['keyPackages']);
  let shutdown: Promise<void> | undefined;
  return {
    client: resource.value,
    disposeSigner: signer.dispose,
    release: resource.release,
    shutdown: () =>
      (shutdown ??= (async () => {
        try {
          const draining = resource.stop();
          await network.shutdown();
          await draining;
          // Marmot 0.4 unloadGroup only evicts its Map. It cannot zero a group's
          // private MLS state held by callers without destroy() deleting durable history.
          if (client.groups.length)
            throw new Error('Marmot loaded MLS groups have no non-destructive release API');
        } finally {
          try {
            client.removeAllListeners();
          } finally {
            signer.dispose();
          }
        }
      })()),
  };
}
