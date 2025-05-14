import { MintKeys, MintKeyset } from '@cashu/cashu-ts';
import { setKeysets } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { getMint } from './mint';
import { Alert } from 'react-native';

interface GetKeysParams {
  unit: string;
  mintUrl: string;
}

export async function getKeys({ unit, mintUrl }: GetKeysParams): Promise<MintKeyset | undefined> {
  const mint = getMint({ mintUrl });

  const keysets = (await (await mint).getKeySets()).keysets;

  const key = keysets.find((k) => k.unit === unit);

  // Store the keyset in cache
  store.dispatch(
    setKeysets({
      mintUrl,
      keysets,
    })
  );

  return key;
}
