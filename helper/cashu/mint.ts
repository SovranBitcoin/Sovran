import { CashuMint } from '@cashu/cashu-ts';
import { memoizedGetMintInfo, setInfo, setKeys, setKeysets } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { Alert } from 'react-native';

interface GetMintParams {
  mintUrl: string;
  forceRefresh?: boolean;
}

export async function getMint({ mintUrl, forceRefresh = false }: GetMintParams) {
  const mint = new CashuMint(mintUrl);

  if (forceRefresh) {
    const mintInfo = await mint.getInfo();

    Alert.alert('Mint updated1');
    store.dispatch(
      setInfo({
        mintUrl,
        mintInfo,
      })
    );

    Alert.alert('Mint updated2');
    store.dispatch(setKeysets({ mintUrl, keysets: (await mint.getKeySets()).keysets }));
    Alert.alert('Mint updated3');
    store.dispatch(setKeys({ mintUrl, keys: (await mint.getKeys()).keysets }));
  }

  return mint;
}
