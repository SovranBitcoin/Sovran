import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useSelector } from 'react-redux';
import { SheetManager } from 'react-native-actions-sheet';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetSelectedMint, memoizedGetBalance } from 'helper/redux/cashu';
import { useGetMintInfo } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import Icon from 'assets/icons';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { store } from 'helper/redux/store';
import { MintIcon, createStyles, sovran } from 'components/layout/sheets/mints';

interface Props {
  unit: string;
  onMintSelected?: (
    mint: { id: string; name: string; iconUrl: string | null; unit: string },
    balance: { amount: number; unit: string }
  ) => void | Promise<void>;
  /**
   * When true, prevent selecting mints that have no balance.
   * Defaults to true.
   */
  requireBalance?: boolean;
  style?: StyleProp<ViewStyle>;
}

const MintBalanceDisplay: React.FC<Props> = ({
  unit,
  onMintSelected,
  requireBalance = true,
  style,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const mintInfo = useGetMintInfo({ mintUrl: selectedMint });
  const balance = useSelector(memoizedGetBalance(unit, selectedMint));

  const handlePress = () => {
    SheetManager.show('mint-balance', {
      payload: { navigate: false, requireBalance },
      onClose: (mint?: { id: string; unit: string }) => {
        if (mint?.id && onMintSelected) {
          const amt = memoizedGetBalance(unit, mint.id)(store.getState());
          onMintSelected(mint, { amount: amt, unit });
        }
      },
    });
  };

  return (
    <TouchableOpacity onPress={handlePress}>
      <View
        blur
        style={[
          sovran(theme).listItem,
          { alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: greys(theme)[800] },
          style,
        ]}
      >
        <View style={{ flexDirection: 'row' }}>
          <MintIcon mintInfo={mintInfo} />
          <View style={{ flexDirection: 'column', alignItems: 'flex-start', marginRight: 10 }}>
            <Text style={styles.name}>
              {mintInfo?.name || selectedMint?.replace('https://', '').split('/')[0]}
            </Text>
            <AmountFormatter size={12} weight="heavy" amount={balance} unit={unit} />
          </View>
        </View>
        <View style={styles.chevronContainer}>
          <Icon name="fluent:chevron-down-12-filled" size={12} color={greys(theme)[400]} />
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default MintBalanceDisplay;
