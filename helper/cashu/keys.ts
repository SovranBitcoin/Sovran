import { MintKeys, MintKeyset } from '@cashu/cashu-ts';
import { setKeys, setKeysets } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { getMint } from './mint';
import { Alert } from 'react-native';

interface GetKeysParams {
  unit: string;
  mintUrl: string;
  forceRefresh?: boolean;
}

export async function getKeys({
  unit,
  mintUrl,
  forceRefresh = false,
}: GetKeysParams): Promise<MintKeyset | undefined> {
  const mint = getMint({ mintUrl });

  // check if keysets and keys are already cached
  if (store.getState().cashu.keysets[mintUrl] && !forceRefresh) {
    return store.getState().cashu.keysets[mintUrl].find((k) => k.unit === unit);
  }

  const keysets = (await (await mint).getKeySets()).keysets;
  const keys = (await (await mint).getKeys()).keysets;

  const key = keysets.find((k) => k.unit === unit);

  // Store the keyset in cache
  store.dispatch(
    setKeysets({
      mintUrl,
      keysets,
    })
  );

  store.dispatch(
    setKeys({
      mintUrl,
      keys,
    })
  );

  return key;
}
