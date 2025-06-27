import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { View } from 'components/common/View';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { greys } from 'helper/colors';
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

  const defaultColors: readonly [string, string, ...string[]] = [
    theme.greys[2300],
    opacity(theme.greys[2300], 0.9),
    opacity(theme.greys[2300], 0.85),
    opacity(theme.greys[2300], 0.755),
    opacity(theme.greys[2300], 0.33),
    opacity(theme.greys[2300], 0),
  ] as const;
  return null;
  return (
    <LinearGradient
      colors={defaultColors}
      style={{
        width: '100%',
        height: 100,
        pointerEvents: 'none',
      }}></LinearGradient>
  );
}

export default function WalletHeader({ unit, accounts, setAccount }: WalletHeaderProps) {
  const theme = useSelector(memoizedGetTheme);
  const profileId = useSelector(memoizedGetCurrentProfile).id;
  const dispatch = useDispatch();
  const styles = createStyles(theme);

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));
    const index = accounts.findIndex((a) => a.unit === mint.unit);
    if (index !== -1) {
      setAccount(accounts[index]);
    }
  };

  return (
    <View style={styles.container}>
      <SelectedMintDisplay
        style={{
          width: Dimensions.get('window').width - 32 - 16 - 16 - 16 - 16 - 16 - 16,
          marginLeft: 50 - 16 - 16 - 16,
        }}
        onMintSelected={handleMintSelected}
        unit={unit}
      />
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      transform: [{ translateX: '-50%' }],
      width: Dimensions.get('window').width,
      height: 52,
      marginTop: 42,
      pointerEvents: 'box-none',
    },
    unitContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 99999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
      height: 40,
      marginBottom: 4,
    },
    unitText: {
      color: theme.greys[200],
    },
  });
