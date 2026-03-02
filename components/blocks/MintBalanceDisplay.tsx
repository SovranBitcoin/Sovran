import React, { useMemo } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Link } from 'expo-router';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { HStack } from 'components/ui/View/HStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { supportsLiquidGlass } from '@/helper/version';
import { useBalanceContext } from 'coco-cashu-react';
import { VStack } from '../ui/View/VStack';
import { View } from '../ui/View/View';
import Icon from '@/assets/icons';
import { AmountFormatter } from '../ui/AmountFormatter';
import { extractDomain } from '@/helper/url';
import { Avatar } from '../ui/Avatar';
import { Text } from '../ui/Text';
import { useThemeColor } from 'hooks/useThemeColor';

interface MintBalanceDisplayProps {
  unit: string;
  requireBalance?: boolean;
  allowedMints?: string[];
  style?: StyleProp<ViewStyle>;
  requireValidMint?: boolean;
  showAddMintsButton?: boolean;
  showDetailsButton?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  mintName?: string;
  mintIconUrl?: string;
  isLoadingMint?: boolean;
}

const MintBalanceDisplay: React.FC<MintBalanceDisplayProps> = ({
  unit,
  requireBalance = true,
  allowedMints,
  requireValidMint = false,
  showAddMintsButton = false,
  showDetailsButton = false,
  contentWidth,
  contentHeight,
  mintName,
  mintIconUrl,
  isLoadingMint = false,
  style,
}) => {
  const [foreground, defaultColor, surfaceSecondary] = useThemeColor([
    'foreground',
    'default',
    'surface-secondary',
  ] as const);

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const { balance: liveBalances } = useBalanceContext();
  const balance = selectedMint ? liveBalances[selectedMint] || 0 : 0;

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

  const innerHeight = contentHeight ?? 36;
  const innerWidth = contentWidth;

  const displayName = mintName || extractDomain(selectedMint || '');

  const mintInfoContent = (
    <HStack
      align="center"
      justify="space-between"
      style={{ height: innerHeight, width: innerWidth }}>
      <HStack align="center">
        {showMintInfo ? (
          <>
            <View className="mr-1">
              <Avatar
                picture={mintIconUrl}
                size={32}
                variant="mint"
                name={mintName}
                loading={isLoadingMint}
                alt={`${mintName || 'Mint'} icon`}
              />
            </View>
            <VStack align="flex-start">
              <Text
                loading={isLoadingMint}
                placeholder="Mint Name"
                style={{ color: foreground }}
                size={12}
                bold>
                {displayName || undefined}
              </Text>
              {isLoadingMint ? (
                <Text loading placeholder="1,000 sats" size={12} bold>
                  {null}
                </Text>
              ) : (
                <AmountFormatter
                  className="ml-1"
                  size={12}
                  weight="heavy"
                  amount={balance}
                  unit={unit}
                />
              )}
            </VStack>
          </>
        ) : (
          <HStack align="center" gap={8}>
            <Icon name="fluent:add-24-filled" size={20} color={foreground} />
            <Text style={{ color: foreground }} className="ml-[-2px] opacity-90" size={12} bold>
              Selected mint
            </Text>
          </HStack>
        )}
      </HStack>

      <View className="mr-2">
        <Icon name="fluent:chevron-down-12-filled" size={12} color={foreground} />
      </View>
    </HStack>
  );

  if (supportsLiquidGlass()) {
    return (
      <Link
        href={linkHref}
        style={{ width: contentWidth ?? '100%', height: contentHeight ?? '100%' }}>
        {mintInfoContent}
      </Link>
    );
  }

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
              flexGrow: 0,
              flexShrink: 0,
              width: '100%',
              padding: 8,
              borderWidth: 0.2,
              borderColor: defaultColor,
              alignSelf: 'center',
              backgroundColor: surfaceSecondary,
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
