import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { View } from 'components/common/Themed';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { setSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

interface AccountType {
  key: string;
  unit: string;
  type: string;
}

interface WalletHeaderProps {
  unit: string;
  accounts: AccountType[];
  setAccount: (account: AccountType) => void;
}

export function Background() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const defaultColors: readonly [string, string, ...string[]] = [
    greys(theme)[2300],
    opacity(greys(theme)[2300], 0.9),
    opacity(greys(theme)[2300], 0.85),
    opacity(greys(theme)[2300], 0.755),
    opacity(greys(theme)[2300], 0.33),
    opacity(greys(theme)[2300], 0),
  ] as const;

  return (
    <LinearGradient
      colors={defaultColors}
      style={{
        width: '100%',
        // position: 'absolute',
        // left: 0,
        // right: 0,
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

  const defaultColors: readonly [string, string, ...string[]] = [
    greys(theme)[2300],
    opacity(greys(theme)[2300], 0.9),
    opacity(greys(theme)[2300], 0.85),
    opacity(greys(theme)[2300], 0.755),
    opacity(greys(theme)[2300], 0.33),
    opacity(greys(theme)[2300], 0),
  ] as const;

  return (
    <View style={styles.container}>
      {/* <LinearGradient
        colors={defaultColors}
        style={{
          width: '100%',
          position: 'absolute',
          top: -42,
          left: 0,
          right: 0,
          height: 100,
          pointerEvents: 'none',
        }}></LinearGradient> */}
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
      width: Dimensions.get('window').width,
      height: 52,
      marginTop: 42,
      pointerEvents: 'box-none',

      // height: 52,
      // marginTop: 42,
      // position: 'absolute',
      // top: -2,
      // left: 0,
      // transform: [{ translateX: '-50%' }],
      // left: 0,
      // right: 0,
      // width: 300,
      // backgroundColor: 'red',
      // flexDirection: 'row',
      // alignItems: 'flex-start',
      // justifyContent: 'flex-start',
      // pointerEvents: 'box-none',
      // marginTop: 28,
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
      color: greys(theme)[200],
    },
  });
