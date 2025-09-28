import React, { useState, createContext, useRef } from 'react';
import { CashuMint, CashuWallet } from '@cashu/cashu-ts';

type WalletsContextType = {
  connect: ({ mintUrl }: { mintUrl: string }) => Promise<CashuWallet>;
  getWallet: ({ mintUrl }: { mintUrl: string }) => CashuWallet;
  wallets: CashuWallet[];
} | null;

const WalletsContext = createContext<WalletsContextType>(null);

export const WalletsProvider = ({ children }: { children: React.ReactNode }) => {
  const walletsRef = useRef(new Map());
  const [wallets, setWallets] = useState<CashuWallet[]>([]);

  const connect = async ({ mintUrl }: { mintUrl: string }): Promise<CashuWallet> => {
    const wallet = new CashuWallet(new CashuMint(mintUrl));
    await wallet.loadMint();

    walletsRef.current.set(mintUrl, wallet);
    setWallets([...walletsRef.current.values()]);
    return wallet;
  };

  const getWallet = ({ mintUrl }: { mintUrl: string }): CashuWallet => {
    return walletsRef.current.get(mintUrl);
  };

  const value = { connect, getWallet, wallets };

  return <WalletsContext.Provider value={value}>{children}</WalletsContext.Provider>;
};
