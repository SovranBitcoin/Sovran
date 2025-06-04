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

    store.dispatch(
      setInfo({
        mintUrl,
        mintInfo,
      })
    );
    store.dispatch(setKeysets({ mintUrl, keysets: (await mint.getKeySets()).keysets }));
    store.dispatch(setKeys({ mintUrl, keys: (await mint.getKeys()).keysets }));
  }

  return mint;
}
