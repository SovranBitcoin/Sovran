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

export async function getWallet({ unit, mintUrl, profile }: GetWalletParams) {
  if (walletCache[mintUrl]) {
    return walletCache[mintUrl];
  }

  let times = []; // Reset times array for each call
  const startTime = performance.now();
  times.push(startTime);

  const currentProfile = profile?.pubkey ? profile : memoizedGetCurrentProfile(store.getState());
  times.push(performance.now());

  const mintInfo = store.getState().cashu.info[mintUrl];
  times.push(performance.now());

  const keys = store.getState().cashu.keys[mintUrl];
  times.push(performance.now());

  const keysets = store.getState().cashu.keysets[mintUrl];
  times.push(performance.now());

  const mint = await getMint({ mintUrl, forceRefresh: !(keysets || keys) });
  times.push(performance.now());

  const cashuMnemonic = currentProfile.nut13; // its better than recomputing it
  times.push(performance.now());

  const wallet = new CashuWallet(mint, {
    keys,
    keysets,
    mintInfo,
    bip39seed: mnemonicToSeedSync(cashuMnemonic),
  });
  times.push(performance.now());

  wallet._send = async function (amount, currentProofs, options = {}) {
    const { keep, send } = await this.send(Number(amount), currentProofs, options);
    const used = _.differenceWith(currentProofs, keep, (a, b) =>
      _.isEqual(_.pick(a, ['C', 'secret', 'amount']), _.pick(b, ['C', 'secret', 'amount']))
    );
    return { keep, send, used };
  };
  times.push(performance.now());

  // Convert to seconds from function start
  const secondsFromStart = times.map((time) => (time - startTime) / 1000);

  // Calculate step durations in seconds
  const stepDurations = [];
  for (let i = 1; i < secondsFromStart.length; i++) {
    stepDurations.push(secondsFromStart[i] - secondsFromStart[i - 1]);
  }

  const totalTime = secondsFromStart[secondsFromStart.length - 1];
  const longestStep = Math.max(...stepDurations);
  const shortestStep = Math.min(...stepDurations);

  console.log(
    'Wallet created in',
    totalTime.toFixed(3),
    's',
    '\nTimestamps (seconds from start):',
    secondsFromStart.map((t) => t.toFixed(3) + 's'),
    '\nStep durations:',
    stepDurations.map((d) => d.toFixed(3) + 's'),
    '\nLongest step:',
    longestStep.toFixed(3),
    's',
    '\nShortest step:',
    shortestStep.toFixed(3),
    's'
  );

  walletCache[mintUrl] = wallet;

  return wallet;
}
