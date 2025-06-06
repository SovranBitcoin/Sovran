import { useEffect, useState, createContext, useContext, useRef } from 'react';
import { store } from 'helper/redux/store';
import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
import { showMessage } from 'helper/popup/popups';
import { getWallet as loadWallet } from 'helper/cashu';

const WalletsContext = createContext(null);

export const useWallets = () => {
  const context = useContext(WalletsContext);
  if (!context) {
    throw new Error('useWallets must be used within a WalletsProvider');
  }
  return context;
};

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

  // useEffect(() => {
  //   const profile = store.getState().nostr.currentProfile;
  //   const mints =
  //     store.getState().cashu?.profiles?.[profile?.id]?.mints || [];

  //   mints.forEach((mintUrl: string) => {
  //     loadWallet({ unit: 'sat', mintUrl, profile, forceRefresh: true }).catch(
  //       (e) => console.log('wallet preload error', e)
  //     );
  //   });
  // }, []);

  const value = { connect, getWallet, wallets };

  return <WalletsContext.Provider value={value}>{children}</WalletsContext.Provider>;
};
