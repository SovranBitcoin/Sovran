import React, { useCallback } from 'react';
import { Dimensions } from 'react-native';
import { View } from 'components/ui/View';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { useTheme } from 'providers/ThemeProvider';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useRoute } from '@react-navigation/native';

interface AccountType {
  unit: string;
}

interface WalletHeaderProps {
  unit: string;
  accounts: AccountType[];
  setAccount: (account: AccountType) => void;
}

export function Background() {
  const { getPrimaryColor } = useTheme();
  const route = useRoute();

  if (route.name === 'payments') {
    return null;
  }

  return (
    <LinearGradient
      colors={[getPrimaryColor('900'), opacity(getPrimaryColor('900'), 0)]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={{
        width: '100%',
        height: 100,
        pointerEvents: 'none',
      }}
    />
  );
}

export default function WalletHeader({ unit, accounts, setAccount }: WalletHeaderProps) {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;

  if (__DEV__) {
    console.log('WalletHeader: keys from NostrKeysContext:', keys);
  }
  const setSelectedMint = useMintStore((state) => state.setSelectedMint);

  if (__DEV__) {
    console.log('WalletHeader: props and state:', { unit, accounts, pubkey });
  }

  const handleMintSelected = useCallback(
    async (mint: { id: string; unit: string }, _balance?: { amount: number; unit: string }) => {
      if (__DEV__) {
        console.log('WalletHeader: handleMintSelected called with:', {
          mint,
          pubkey,
          hasPubkey: !!pubkey,
        });
      }

      if (!pubkey) {
        if (__DEV__) {
          console.warn('WalletHeader: No pubkey available, cannot set selected mint');
        }
        return;
      }

      if (__DEV__) {
        console.log('WalletHeader: Setting selected mint in store:', {
          pubkey,
          mintId: mint.id,
        });
      }
      setSelectedMint(pubkey, mint.id);

      const index = accounts.findIndex((a) => a.unit === mint.unit);
      if (__DEV__) {
        console.log(
          'WalletHeader: Looking for account with unit:',
          mint.unit,
          'found index:',
          index
        );
      }
      if (index !== -1) {
        if (__DEV__) {
          console.log('WalletHeader: Setting account to:', accounts[index]);
        }
        setAccount(accounts[index]);
      } else {
        if (__DEV__) {
          console.warn('WalletHeader: No account found for unit:', mint.unit);
        }
      }
    },
    [pubkey, setSelectedMint, accounts, setAccount]
  );

  return (
    <View
      className="h-13 pointer-events-box-none absolute left-0 right-0 pt-5"
      style={{ marginTop: 32 }}>
      <MintBalanceDisplay
        unit={unit}
        onMintSelected={handleMintSelected}
        requireBalance={false}
        updateSelectedMint={true}
        showAddMintsButton={true}
        showDetailsButton={true}
        style={{ width: Dimensions.get('window').width - 124 - 16 }}
      />
    </View>
  );
}
