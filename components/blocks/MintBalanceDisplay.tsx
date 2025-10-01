import React, { useMemo, useEffect, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useSelector } from 'react-redux';
import { SheetManager } from 'react-native-actions-sheet';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { useMintManagement } from 'hooks/coco';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { Avatar } from 'components/ui/Avatar';

interface MintBalanceDisplayProps {
  unit: string;
  onMintSelected?: (
    mint: { id: string; name: string; iconUrl: string | null; unit: string },
    balance: { amount: number; unit: string }
  ) => void | Promise<void>;
  requireBalance?: boolean;
  updateSelectedMint?: boolean;
  allowedMints?: string[];
  allowedUnits?: string[];
  style?: StyleProp<ViewStyle>;
  requireValidMint?: boolean;
  showAddMintsButton?: boolean;
}

const MintBalanceDisplay: React.FC<MintBalanceDisplayProps> = ({
  unit,
  onMintSelected,
  requireBalance = true,
  updateSelectedMint = true,
  allowedMints,
  allowedUnits,
  requireValidMint = false,
  showAddMintsButton = false,
  style,
}) => {
  const theme = useSelector(memoizedGetTheme);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const { getMintInfo, getBalances } = useMintManagement();

  // State for Coco data
  const [mintInfo, setMintInfo] = useState<any>(null);
  const [balance, setBalance] = useState(0);

  // Load mint info and balance from Coco
  useEffect(() => {
    const loadMintData = async () => {
      if (selectedMint) {
        try {
          const [mintInfoData, balances] = await Promise.all([
            getMintInfo(selectedMint),
            getBalances(),
          ]);
          setMintInfo(mintInfoData);
          setBalance(balances[selectedMint] || 0);
        } catch (error) {
          console.error('Failed to load mint data:', error);
          setMintInfo(null);
          setBalance(0);
        }
      }
    };

    loadMintData();
  }, [selectedMint, getMintInfo, getBalances]);

  const isMintAllowed = useMemo(
    () => (allowedMints && selectedMint ? allowedMints.includes(selectedMint) : true),
    [allowedMints, selectedMint]
  );

  const showMintInfo = !(requireValidMint && !isMintAllowed);

  const handlePress = async () => {
    SheetManager.show('mint-balance', {
      payload: {
        navigate: false,
        requireBalance,
        updateSelectedMint,
        allowedMints,
        allowedUnits,
        showAddMintsButton,
        onMintPress: updateSelectedMint ? undefined : onMintSelected,
      },
      onClose: async (mint) => {
        if (mint?.id && onMintSelected && updateSelectedMint) {
          try {
            const balances = await getBalances();
            const amt = balances[mint.id] || 0;
            onMintSelected(mint, { amount: amt, unit });
          } catch (error) {
            console.error('Failed to get balance for mint:', error);
            onMintSelected(mint, { amount: 0, unit });
          }
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
          {
            padding: 8,
            borderRadius: 16,
            borderWidth: 0.2,
            borderColor: greys(theme)[600],
            marginVertical: 4,
            alignSelf: 'center',
            backgroundColor: greys(theme)[800],
          },
          style,
        ]}>
        <HStack align="center">
          {showMintInfo ? (
            <>
              <View style={{ marginRight: 8 }}>
                <Avatar
                  picture={mintInfo?.icon_url || undefined}
                  size={32}
                  variant="mint"
                  name={mintInfo?.name}
                  alt={`${mintInfo?.name || 'Mint'} icon`}
                />
              </View>
              <VStack align="flex-start" style={{ marginRight: 10 }}>
                <Text
                  style={{
                    color: greys(theme)[50],
                  }}
                  className="ml-[-2px]"
                  size={12}
                  bold
                  overpass>
                  {mintInfo?.name ||
                    selectedMint?.replace('https://', '').split('/')[0] ||
                    'Unknown Mint'}
                </Text>
                <AmountFormatter size={12} weight="heavy" amount={balance} unit={unit} />
              </VStack>
            </>
          ) : (
            <HStack align="center" gap={8}>
              <Icon name="fluent:add-24-filled" size={20} color={greys(theme)[0]} />
              <Text
                style={{
                  color: greys(theme)[50],
                }}
                className="ml-[-2px]"
                size={12}
                bold
                overpass>
                Selected mint
              </Text>
            </HStack>
          )}
        </HStack>
        <HStack justify="flex-end" align="center">
          <Icon name="fluent:chevron-down-12-filled" size={12} color={greys(theme)[0]} />
          <Spacer size={8} />
        </HStack>
      </HStack>
    </TouchableOpacity>
  );
};

export default MintBalanceDisplay;
