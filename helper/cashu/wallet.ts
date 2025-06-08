import { CashuWallet } from "@cashu/cashu-ts";
import { store } from "helper/redux/store";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { getKeys } from "./keys";
import { getMint } from "./mint";
import { auditMint } from "helper/api/sovran";
import { memoizedGetCurrentProfile } from "../redux/nostr";
import { setAudit } from "helper/redux/cashu";
import _ from "lodash";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToSeed, mnemonicToSeedSync } from "bip39";
import { useState, useEffect } from "react";

interface GetWalletParams {
  unit: string;
  mintUrl: string;
  profile: any;
}

// wallet caches for all the mints
let walletCache: { [key: string]: CashuWallet } = {};

export function getUsedProofs(currentProofs, keepProofs) {
  const usedProofs = [];

  for (const currentProof of currentProofs) {
    const isKept = keepProofs.some(
      (keepProof) =>
        keepProof.C === currentProof.C &&
        keepProof.secret === currentProof.secret &&
        keepProof.amount === currentProof.amount,
    );

    if (!isKept) {
      usedProofs.push(currentProof);
    }
  }

  return usedProofs;
}

export async function getWallet({
  unit,
  mintUrl,
  profile,
  forceRefresh = false,
}: GetWalletParams) {
  if (walletCache[mintUrl] && !forceRefresh) {
    return walletCache[mintUrl];
  }

  const currentProfile = profile?.pubkey
    ? profile
    : memoizedGetCurrentProfile(store.getState());

  let mintInfo = store.getState().cashu?.info?.[mintUrl];
  let keys = store.getState().cashu?.keys?.[mintUrl];
  let keysets = store.getState().cashu?.keysets?.[mintUrl];
  const shouldRefresh = forceRefresh || !mintInfo || !keys || !keysets;

  const mint = await getMint({
    mintUrl,
    forceRefresh: shouldRefresh,
  });

  mintInfo = store.getState().cashu?.info?.[mintUrl];
  keys = store.getState().cashu?.keys?.[mintUrl];
  keysets = store.getState().cashu?.keysets?.[mintUrl];

  const cashuMnemonic = currentProfile.nut13; // its better than recomputing it

  const wallet = new CashuWallet(mint, {
    ...(shouldRefresh
      ? { keys, keysets, mintInfo }
      : { keys, keysets, mintInfo }),
    bip39seed: mnemonicToSeedSync(cashuMnemonic),
  });

  wallet.audits = store.getState().cashu?.audits?.[mintUrl];

  if (forceRefresh || !wallet.audits) {
    auditMint({ mintUrl })
      .then((audit) => {
        store.dispatch(setAudit({ mintUrl, audit }));
        wallet.audits = audit;
      })
      .catch((err) => console.error("Failed to fetch audit", err));
  }

  wallet._send = async function (amount, currentProofs, options = {}) {
    console.log(129837, this.keysetId);
    const { keep, send } = await this.send(
      Number(amount),
      currentProofs,
      options,
    );
    const used = getUsedProofs(currentProofs, keep);
    return { keep, send, used };
  };

  walletCache[mintUrl] = wallet;

  return wallet;
}

export function useWallet({ unit, mintUrl, profile, forceRefresh = false }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchWallet = async () => {
      try {
        setLoading(true);
        setError(null);

        const walletInstance = await getWallet({
          unit,
          mintUrl,
          profile,
          forceRefresh,
        });

        if (isMounted) {
          setWallet(walletInstance);
        }
      } catch (err) {
        if (isMounted) {
          setError(err);
          console.error("Failed to get wallet:", err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (mintUrl) {
      fetchWallet();
    } else {
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [unit, mintUrl, profile, forceRefresh]);

  const refetch = () => {
    if (mintUrl) {
      setWallet(null);
      setError(null);
      setLoading(true);

      getWallet({
        unit,
        mintUrl,
        profile,
        forceRefresh: true,
      })
        .then(setWallet)
        .catch(setError)
        .finally(() => setLoading(false));
    }
  };

  return {
    wallet,
    loading,
    error,
    refetch,
  };
}
