import React, { useRef } from 'react';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from 'helper/redux/cashu/selectors';
import { useMintManagement } from 'hooks/coco';
import Icon from 'assets/icons';
import { ActionSheetRef } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Avatar } from 'components/ui/Avatar';

type MintSelectorButtonProps = {
  onPress?: () => void;
  unit?: string;
  actionSheetRef: React.RefObject<ActionSheetRef | null>;
  width?: number;
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
};

const MintSelectorButton: React.FC<MintSelectorButtonProps> = ({
  onPress,
  unit,
  actionSheetRef: _actionSheetRef,
  width,
  onMintSelected,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const { getBalances } = useMintManagement();

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const { getMintInfo } = useMintManagement();
  const [mintInfo, setMintInfo] = React.useState<{ name?: string }>({});

  const handlePress = () => {
    if (onPress) {
      onPress();
    }
    // Open the mint-balance sheet instead of the mint sheet
    import('react-native-actions-sheet').then(({ SheetManager }) => {
      SheetManager.show('mint-balance', {
        payload: {
          onMintPress: onMintSelected,
          showAddMintsButton: true,
          showDetailsButton: true,
          requireBalance: false,
          updateSelectedMint: true,
        },
      });
    });
  };

  // Get balance from Coco
  const [balance, setBalance] = React.useState(0);

  // Load mint info when selectedMint changes
  React.useEffect(() => {
    const loadMintInfo = async () => {
      if (selectedMint) {
        try {
          const info = await getMintInfo(selectedMint);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      } else {
        setMintInfo({});
      }
    };
    loadMintInfo();
  }, [selectedMint, getMintInfo]);

  React.useEffect(() => {
    const loadBalance = async () => {
      if (selectedMint) {
        try {
          const balances = await getBalances();
          setBalance(balances[selectedMint] || 0);
        } catch (error) {
          console.error('Failed to load balance:', error);
          setBalance(0);
        }
      } else {
        setBalance(0);
      }
    };
    loadBalance();
  }, [selectedMint, getBalances]);

  return (
    <TouchableOpacity onPress={handlePress}>
      <HStack
        blur
        align="center"
        justify="space-between"
        className={` items-center justify-between self-center rounded-xl p-2`}
        style={[
          {
            width: width,
            backgroundColor: theme.greys[800],
          },
        ]}>
        <HStack spacing={8}>
          <View>
            <Avatar
              picture={(mintInfo as any)?.icon_url || undefined}
              size={32}
              variant="mint"
              name={mintInfo?.name}
              alt={`${mintInfo?.name || 'Mint'} icon`}
            />
          </View>
          <VStack align="flex-start">
            <Text
              style={{
                color: greys(theme)[50],
              }}
              className="ml-[-2px]"
              size={12}
              bold
              overpass>
              {mintInfo?.name ||
                selectedMint?.replace('https://', '')?.split('/')?.[0] ||
                'Unknown Mint'}
            </Text>
            <AmountFormatter size={12} weight="heavy" amount={balance} unit={unit || 'sat'} />
          </VStack>
        </HStack>
        <HStack justify="flex-end" align="center">
          <Icon name="fluent:chevron-down-12-filled" size={12} color={greys(theme)[0]} />
          <Spacer size={8} />
        </HStack>
      </HStack>
    </TouchableOpacity>
  );
};

interface SelectedMintDisplayProps {
  onPress?: () => void;
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
  unit?: string;
  actionSheetRef?: React.RefObject<ActionSheetRef | null>;
  width?: number;
}

const SelectedMintDisplayList = ({ onMintSelected, unit, width }: SelectedMintDisplayProps) => {
  const actionSheetRef = useRef<ActionSheetRef>(null);

  return (
    <MintSelectorButton
      width={width}
      unit={unit}
      actionSheetRef={actionSheetRef}
      onMintSelected={onMintSelected}
    />
  );
};

export { SelectedMintDisplayList };
