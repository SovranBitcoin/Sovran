import { CashuWallet } from '@cashu/cashu-ts';
import { store } from 'helper/redux/store';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { getKeys } from './keys';
import { getMint } from './mint';
import { memoizedGetCurrentProfile } from '../redux/nostr';
import _ from 'lodash';
import { wordlist } from '@scure/bip39/wordlists/english';
import { mnemonicToSeed, mnemonicToSeedSync } from 'bip39';

interface GetWalletParams {
  unit: string;
  mintUrl: string;
  profile: any;
}

// wallet caches for all the mints
let walletCache: { [key: string]: CashuWallet } = {};

export async function getWallet({ unit, mintUrl, profile, forceRefresh = false }: GetWalletParams) {
  const mintInfo = store.getState().cashu?.info?.[mintUrl];
  const keys = store.getState().cashu?.keys?.[mintUrl];
  const keysets = store.getState().cashu?.keysets?.[mintUrl];

  const shouldRefresh = !(keysets && keys && mintInfo) || forceRefresh;

  if (walletCache[mintUrl] && !shouldRefresh) {
    return walletCache[mintUrl];
  }

  const currentProfile = profile?.pubkey ? profile : memoizedGetCurrentProfile(store.getState());

  const mint = await getMint({
    mintUrl,
    forceRefresh: shouldRefresh,
  });
  const cashuMnemonic = currentProfile.nut13; // its better than recomputing it

  const wallet = new CashuWallet(mint, {
    ...(shouldRefresh ? {} : { keys, keysets, mintInfo }),
    bip39seed: mnemonicToSeedSync(cashuMnemonic),
  });

  wallet._send = async function (amount, currentProofs, options = {}) {
    const { keep, send } = await this.send(Number(amount), currentProofs, options);
    const used = _.differenceWith(currentProofs, keep, (a, b) =>
      _.isEqual(_.pick(a, ['C', 'secret', 'amount']), _.pick(b, ['C', 'secret', 'amount']))
    );
    return { keep, send, used };
  };

  walletCache[mintUrl] = wallet;

  return wallet;
}
