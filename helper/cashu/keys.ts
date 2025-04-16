import {
  MintKeys
} from "@cashu/cashu-ts";
import { setKeysets } from "helper/redux/cashu";
import { store } from "helper/redux/store";
import { getMint } from "./mint";

interface GetKeysParams {
  unit: string;
  mintUrl: string;
}

export async function getKeys({
  unit,
  mintUrl,
}: GetKeysParams): Promise<MintKeys | undefined> {
  const mint = getMint({ mintUrl });

  const keysets = (await (await mint).getKeys()).keysets;

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