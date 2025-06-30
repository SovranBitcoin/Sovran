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
    greys(theme)[950],
    opacity(greys(theme)[950], 0.9),
    opacity(greys(theme)[950], 0.85),
    opacity(greys(theme)[950], 0.755),
    opacity(greys(theme)[950], 0.33),
    opacity(greys(theme)[950], 0),
  ] as const;

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

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      transform: [{ translateX: '-50%' }],
      width: 0,
      height: 52,
      marginTop: 42,
      pointerEvents: 'box-none',
      backgroundColor: 'red',
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
      color: greys(theme)[100],
    },
  });
