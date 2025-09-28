import React, { useMemo } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useSelector } from 'react-redux';
import { SheetManager } from 'react-native-actions-sheet';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetSelectedMint, memoizedGetBalance, useGetMintInfo } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { store } from 'helper/redux/store';
import { MintIcon, createStyles, sovran } from 'components/blocks/sheets/mints';

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
  /**
   * When false, the sheet will not automatically update the selected mint.
   * Defaults to true.
   */
  updateSelectedMint?: boolean;
  allowedMints?: string[];
  allowedUnits?: string[];
  style?: StyleProp<ViewStyle>;
  requireValidMint?: boolean;
}

const MintBalanceDisplay: React.FC<Props> = ({
  unit,
  onMintSelected,
  requireBalance = true,
  updateSelectedMint = true,
  allowedMints,
  allowedUnits,
  requireValidMint = false,
  style,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const mintInfo = useGetMintInfo({ mintUrl: selectedMint });
  const balance = useSelector(memoizedGetBalance(unit, selectedMint));

  const isMintAllowed = useMemo(
    () => (allowedMints ? allowedMints.includes(selectedMint) : true),
    [allowedMints, selectedMint]
  );

  const showMintInfo = !(requireValidMint && !isMintAllowed);

  const handlePress = () => {
    SheetManager.show('mint-balance', {
      payload: {
        navigate: false,
        requireBalance,
        updateSelectedMint,
        allowedMints,
        allowedUnits,
        onMintPress: updateSelectedMint ? undefined : onMintSelected,
      },
      onClose: (mint) => {
        if (mint?.id && onMintSelected && updateSelectedMint) {
          const amt = memoizedGetBalance(unit, mint.id)(store.getState());
          onMintSelected(mint, { amount: amt, unit });
        }
      },
    });
  };

  return (
    <TouchableOpacity onPress={handlePress}>
      <HStack
        blur
        align="center"
        justify="space-between"
        style={[
          sovran(theme).listItem,
          {
            alignSelf: 'center',
            backgroundColor: greys(theme)[800],
          },
          style,
        ]}>
        <HStack align="center">
          {showMintInfo ? (
            <>
              <MintIcon mintInfo={mintInfo} />
              <VStack align="flex-start" style={{ marginRight: 10 }}>
                <Text style={styles.name}>
                  {mintInfo?.name || selectedMint?.replace('https://', '').split('/')[0]}
                </Text>
                <AmountFormatter size={12} weight="heavy" amount={balance} unit={unit} />
              </VStack>
            </>
          ) : (
            <HStack align="center" gap={8}>
              <Icon name="fluent:add-24-filled" size={20} color={greys(theme)[0]} />
              <Text style={styles.name}>Selected mint</Text>
            </HStack>
          )}
        </HStack>
        <View style={styles.chevronContainer}>
          <Icon name="fluent:chevron-down-12-filled" size={12} color={greys(theme)[0]} />
        </View>
      </HStack>
    </TouchableOpacity>
  );
};

export default MintBalanceDisplay;
