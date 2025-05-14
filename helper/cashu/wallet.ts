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

const DERIVATION_PATH = `m/44'/129372'`;

export async function getWallet({ unit, mintUrl, profile }: GetWalletParams) {
  const keys = await getKeys({ unit, mintUrl });

  if (!keys) {
    throw {
      message: 'unsupported_currency',
      params: {
        unit,
        mintUrl,
      },
    };
  }

  const mint = await getMint({ mintUrl });

  const currentProfile = profile?.pubkey ? profile : memoizedGetCurrentProfile(store.getState());

  const root = getRoot(currentProfile);

  const seed = root.derive(`${DERIVATION_PATH}/0'/${currentProfile?.id}'/0/0`);

  const cashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Uint8Array, wordlist);

  const wallet = new CashuWallet(mint, {
    unit,
    bip39seed: mnemonicToSeedSync(cashuMnemonic),
  });

  wallet._send = async function (amount, currentProofs, options = {}) {
    const { keep, send } = await this.send(Number(amount), currentProofs, options);

    const used = _.differenceWith(currentProofs, keep, (a, b) =>
      _.isEqual(_.pick(a, ['C', 'secret', 'amount']), _.pick(b, ['C', 'secret', 'amount']))
    );

    console.log({ keep, send, used });

    return { keep, send, used };
  };

  await wallet.loadMint();

  return wallet;
}

function getRoot(currentProfile) {
  if (!currentProfile?.root?.xpriv) {
    const root = HDKey.fromExtendedKey(currentProfile?.root?.xpriv);
    if (root) {
      return root;
    }
  }

  const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(currentProfile?.mnemonic));

  return root;
}
