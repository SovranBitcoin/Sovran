import React from 'react';
import { Dimensions } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import SelectedMintDisplay from 'components/blocks/sheets/mints';
import { memoizedGetTheme } from 'helper/redux/settings';
import { setSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

interface AccountType {
  unit: string;
}

interface WalletHeaderProps {
  unit: string;
  accounts: AccountType[];
  setAccount: (account: AccountType) => void;
}

export function Background() {
  const theme = useSelector(memoizedGetTheme);

  return (
    <LinearGradient
      colors={[theme.greys[950], opacity(theme.greys[950], 0)]}
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
  const profileId = useSelector(memoizedGetCurrentProfile).id;
  const dispatch = useDispatch();

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));
    const index = accounts.findIndex((a) => a.unit === mint.unit);
    if (index !== -1) {
      setAccount(accounts[index]);
    }
  };

  return (
    <View
      className="h-13 pointer-events-box-none absolute left-0 right-0 pt-5"
      style={{ marginTop: 32 }}>
      <SelectedMintDisplay
        style={{
          width: Dimensions.get('window').width - 128,
          marginLeft: 2,
        }}
        onMintSelected={handleMintSelected}
        unit={unit}
      />
    </View>
  );
}
