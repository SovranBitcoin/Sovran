import {
  CashuMint
} from "@cashu/cashu-ts";
import {
  memoizedGetMintInfo, setInfo
} from "helper/redux/cashu";
import { store } from "helper/redux/store";

interface GetMintParams {
  mintUrl: string;
}

export async function getMint({ mintUrl }: GetMintParams) {
  const mint = new CashuMint(mintUrl);

  const storedMintInfo = memoizedGetMintInfo(mintUrl)(store.getState());

  if (!storedMintInfo) {
    const mintInfo = await mint.getInfo();

    store.dispatch(
      setInfo({
        mintUrl,
        mintInfo,
      })
    );
  }

  return mint;
}