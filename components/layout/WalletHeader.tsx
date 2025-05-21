import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Text, View } from 'components/common/Themed';
import SelectedMintDisplay, { sovran } from 'components/layout/sheets/mints';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { setSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';

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
      <View
        style={[styles.unitContainer, sovran(theme).backgroundSolid, sovran(theme).borderSubtle]}>
        <Text style={styles.unitText} weight="bold">
          {unit === 'sat' ? 'BTC' : unit.toUpperCase()}
        </Text>
      </View>
      <SelectedMintDisplay onMintSelected={handleMintSelected} unit={unit} />
    </View>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      transform: [{ translateX: '-50%' }],
      // left: 0,
      // right: 0,
      // width: 300,
      // backgroundColor: 'red',
      // flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      pointerEvents: 'box-none',
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
