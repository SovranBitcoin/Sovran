import React, { useMemo, useEffect, useState } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Link } from 'expo-router';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { HStack } from 'components/ui/View/HStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { supportsLiquidGlass } from '@/helper/version';
import { useBalanceContext } from 'coco-cashu-react';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { VStack } from '../ui/View/VStack';
import Icon from '@/assets/icons';
import { Spacer } from '../ui/View/Spacer';
import { AmountFormatter } from '../ui/AmountFormatter';
import { extractDomain } from '@/helper/url';
import { Skeleton } from '../ui/Skeleton';
import { Avatar } from '../ui/Avatar';
import { Text } from '../ui/Text';

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
  /** Inner content width (from parent header layout) */
  contentWidth?: number;
  /** Inner content height (from parent header layout) */
  contentHeight?: number;
}

const MintBalanceDisplay: React.FC<MintBalanceDisplayProps> = ({
  unit,
  onMintSelected: _onMintSelected,
  requireBalance = true,
  updateSelectedMint: _updateSelectedMint = true,
  allowedMints,
  allowedUnits: _allowedUnits,
  requireValidMint = false,
  showAddMintsButton = false,
  showDetailsButton = false,
  contentWidth,
  contentHeight,
  style,
}) => {
  const { getPrimaryColor } = useTheme();

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  // Debug logging
  if (__DEV__) {
    console.log('MintBalanceDisplay: Debug info:', {
      hasKeys: !!keys,
      pubkey: keys?.pubkey,
      selectedMint,
      selectedMints,
      selectedMintFromStore: keys?.pubkey ? selectedMints[keys.pubkey] : 'no pubkey',
    });
  }
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
      if (__DEV__) {
        console.log('MintBalanceDisplay: loadMintInfo called with selectedMint:', selectedMint);
      }
      if (selectedMint) {
        setIsLoadingMintInfo(true);
        try {
          const mintInfoData = await getMintInfo(selectedMint);
          if (__DEV__) {
            console.log('MintBalanceDisplay: loaded mint info:', mintInfoData);
          }
          setMintInfo(mintInfoData);
        } catch (error) {
          if (__DEV__) {
            console.error('Failed to load mint info:', error);
          }
          setMintInfo(null);
        } finally {
          setIsLoadingMintInfo(false);
        }
      } else {
        if (__DEV__) {
          console.log('MintBalanceDisplay: no selectedMint, setting mintInfo to null');
        }
        setMintInfo(null);
      }
    };

    loadMintInfo();
  }, [selectedMint, getMintInfo]);

  const isMintAllowed = useMemo(
    () => (allowedMints && selectedMint ? allowedMints.includes(selectedMint) : true),
    [allowedMints, selectedMint]
  );

  const showMintInfo = !(requireValidMint && !isMintAllowed);

  const linkHref = useMemo(
    () => ({
      pathname: '/list' as const,
      params: {
        requireBalance: String(requireBalance),
        showAddMintsButton: String(showAddMintsButton),
        showDetailsButton: String(showDetailsButton),
        onSelectAction: 'goBack',
        ...(allowedMints && { allowedMints: JSON.stringify(allowedMints) }),
      },
    }),
    [requireBalance, showAddMintsButton, showDetailsButton, allowedMints]
  );

  // Default content dimensions if not provided
  const innerHeight = contentHeight ?? 36;
  const innerWidth = contentWidth;

  const mintInfoContent = (
    <HStack
      align="center"
      justify="space-between"
      style={{ height: innerHeight, width: innerWidth }}>
      {/* Left side: Avatar + Mint info */}
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
                      color: getPrimaryColor('0'),
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
                color: opacity(getPrimaryColor('0'), 0.9),
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

      {/* Right side: Chevron */}
      <View style={{ marginRight: 8 }}>
        <Icon name="fluent:chevron-down-12-filled" size={12} color={getPrimaryColor('0')} />
      </View>
    </HStack>
  );

  // Liquid Glass UI (iOS 26+, iPadOS 26+, macOS 26+)
  if (supportsLiquidGlass()) {
    return (
      <Link
        href={linkHref}
        style={{
          width: contentWidth ?? '100%',
          height: contentHeight ?? '100%',
        }}>
        {mintInfoContent}
      </Link>
    );
  }

  // Blur fallback for older devices
  return (
    <Link href={linkHref} asChild>
      <TouchableOpacity haptics>
        <HStack
          blur
          align="center"
          justify="space-between"
          className="rounded-2xl"
          style={[
            {
              // Avoid stretching inside ScrollView/flex containers (e.g. CurrencyScreen)
              flexGrow: 0,
              flexShrink: 0,
              width: '100%',
              padding: 8,
              borderWidth: 0.2,
              borderColor: getPrimaryColor('600'),
              marginVertical: 0,
              marginHorizontal: 0,
              alignSelf: 'center',
              backgroundColor: getPrimaryColor('800'),
            },
            style,
          ]}>
          {mintInfoContent}
        </HStack>
      </TouchableOpacity>
    </Link>
  );
};

export default MintBalanceDisplay;
