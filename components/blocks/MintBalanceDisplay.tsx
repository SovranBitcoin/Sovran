import React, { useMemo, useEffect, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from 'redux/cashu';
import { useMintManagement, useBalanceContext } from 'hooks/coco';
import { useTheme } from 'providers/ThemeProvider';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { Avatar } from 'components/ui/Avatar';
import { Skeleton } from 'components/ui/Skeleton';
import { extractDomain } from '@/helper/url';

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
  showDetailsButton?: boolean;
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
  showDetailsButton = false,
  style,
}) => {
  const { getPrimaryColor } = useTheme();

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const { getMintInfo } = useMintManagement();

  // Use coco's live balance context for real-time updates
  const { balance: liveBalances } = useBalanceContext();

  // State for mint info only (balance comes from live context)
  const [mintInfo, setMintInfo] = useState<any>(null);
  const [isLoadingMintInfo, setIsLoadingMintInfo] = useState(false);

  // Get the current balance for the selected mint from live context
  const balance = selectedMint ? liveBalances[selectedMint] || 0 : 0;

  // Load mint info from Coco (balance updates automatically via context)
  useEffect(() => {
    const loadMintInfo = async () => {
      if (selectedMint) {
        setIsLoadingMintInfo(true);
        try {
          const mintInfoData = await getMintInfo(selectedMint);
          setMintInfo(mintInfoData);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo(null);
        } finally {
          setIsLoadingMintInfo(false);
        }
      }
    };

    loadMintInfo();
  }, [selectedMint, getMintInfo]);

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
        showDetailsButton,
        onMintPress: updateSelectedMint ? undefined : onMintSelected,
      },
      onClose: async (mint) => {
        if (mint?.id && onMintSelected && updateSelectedMint) {
          // Use live balance from context instead of calling getBalances()
          const amt = liveBalances[mint.id] || 0;
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
          {
            padding: 8,
            borderRadius: 16,
            borderWidth: 0.2,
            borderColor: getPrimaryColor('600'),
            marginVertical: 4,
            alignSelf: 'center',
            backgroundColor: getPrimaryColor('800'),
          },
          style,
        ]}>
        <HStack align="center">
          {showMintInfo ? (
            <>
              <View style={{ marginRight: 4 }}>
                {isLoadingMintInfo ? (
                  <Skeleton className="h-[32px] w-[32px] bg-primary-700" />
                ) : (
                  <Avatar
                    picture={mintInfo?.icon_url || undefined}
                    size={32}
                    variant="mint"
                    name={mintInfo?.name}
                    alt={`${mintInfo?.name || 'Mint'} icon`}
                  />
                )}
              </View>
              <VStack align="flex-start">
                {isLoadingMintInfo ? (
                  <>
                    <Skeleton className="h-[14px] w-[60px] bg-primary-700" />
                    <Spacer size={4} />
                    <Skeleton className="h-[14px] w-[60px] bg-primary-700" />
                  </>
                ) : (
                  <>
                    <Text
                      style={{
                        color: getPrimaryColor('50'),
                      }}
                      size={12}
                      bold
                      overpass>
                      {mintInfo?.name || extractDomain(selectedMint || '') || 'Unknown Mint'}
                    </Text>
                    <AmountFormatter
                      className="ml-[4px]"
                      size={12}
                      weight="heavy"
                      amount={balance}
                      unit={unit}
                    />
                  </>
                )}
              </VStack>
            </>
          ) : (
            <HStack align="center" gap={8}>
              <Icon name="fluent:add-24-filled" size={20} color={getPrimaryColor('0')} />
              <Text
                style={{
                  color: getPrimaryColor('50'),
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
          <Icon name="fluent:chevron-down-12-filled" size={12} color={getPrimaryColor('0')} />
          <Spacer size={8} />
        </HStack>
      </HStack>
    </TouchableOpacity>
  );
};

export default MintBalanceDisplay;
