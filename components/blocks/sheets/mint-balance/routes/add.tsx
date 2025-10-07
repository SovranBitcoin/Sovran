import React, { useState, useEffect, useMemo } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { showMessage } from '@/helper/popup';
import { useMintManagement } from 'hooks/coco';
import { View, VStack, Spacer, HStack } from 'components/ui/View';
import { MintCurrencySelector } from '../MintCurrencySelector';
import { MintSearchInput } from 'components/ui/MintSearchInput';
import { useDebouncedMintValidation } from 'hooks/coco/useDebouncedMintValidation';
import { filterMints, looksLikeMintUrl } from 'helper/fuzzySearch';
import { CocoManager } from 'helper/coco/manager';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { useDiscoveredMints } from '@/hooks/coco/useDiscoveredMints';
import type { DiscoveredMintData } from '@/hooks/coco/useDiscoveredMints';

interface PseudoMint {
  url: string;
  isPseudoMint: true;
  mintInfo?: any;
  name?: string;
}

// Extend DiscoveredMintData to include name for compatibility with filterMints
interface SearchableDiscoveredMint extends DiscoveredMintData {
  name: string;
}

type SearchableMint = SearchableDiscoveredMint | PseudoMint;

const isPseudoMint = (mint: SearchableMint): mint is PseudoMint => {
  return 'isPseudoMint' in mint && mint.isPseudoMint === true;
};

// Convert DiscoveredMintData to SearchableDiscoveredMint
const adaptDiscoveredMint = (mint: DiscoveredMintData): SearchableDiscoveredMint => {
  return {
    ...mint,
    name: mint.auditInfo.auditorData.name || mint.url.replace('https://', '').split('/')[0],
  };
};

interface AddMintItemProps {
  mint: SearchableMint;
  onToggle: (url: string) => void;
  selected: boolean;
}

const AddMintItem: React.FC<AddMintItemProps> = ({ mint, onToggle, selected }) => {
  const { getPrimaryColor } = useTheme();
  const pseudo = isPseudoMint(mint);
  const isDisabled = pseudo ? !looksLikeMintUrl(mint.url) : false;

  // Get display values based on mint type
  const displayName = pseudo
    ? mint.url.replace('https://', '').split('/')[0]
    : mint.auditInfo.auditorData.name || mint.url.replace('https://', '').split('/')[0];

  const iconUrl =
    !pseudo && mint.mintInfo
      ? mint.mintInfo.icon_url
      : pseudo && mint.mintInfo
        ? mint.mintInfo.icon_url
        : undefined;
  const auditorState = !pseudo ? mint.auditInfo.auditorData.state : undefined;
  const score = !pseudo ? mint.auditInfo.score : undefined;
  const recommendations = !pseudo ? mint.auditInfo.recommendations : [];

  return (
    <View
      className="overflow-hidden rounded-lg"
      blur
      style={[{ backgroundColor: getPrimaryColor('800'), marginBottom: 12 }]}>
      <TouchableOpacity disabled={isDisabled} onPress={() => !isDisabled && onToggle(mint.url)}>
        <HStack
          align="center"
          justify="space-between"
          className={`p-3 ${isDisabled ? 'opacity-50' : ''}`}>
          <HStack align="center" gap={8}>
            <Avatar
              picture={iconUrl}
              size={42}
              variant="mint"
              name={displayName}
              alt={`${displayName} icon`}
              status={auditorState}
            />

            <VStack spacing={2}>
              <Text style={[{ color: getPrimaryColor('0'), fontSize: 16 }]}>{displayName}</Text>

              <HStack align="center" gap={4}>
                {pseudo && (
                  <Badge variant="warning" icon="humbleicons:url" size={12}>
                    Custom URL
                  </Badge>
                )}
                {typeof score === 'number' && (
                  <Badge variant="warning" icon="ic:round-star" size={12}>
                    {score % 1 === 0 ? score.toString() : score.toFixed(1)} (
                    {recommendations.length})
                  </Badge>
                )}
                {recommendations.length > 0 && (
                  <Badge variant="success" icon="fluent:checkmark-16-filled" size={12}>
                    {(
                      (recommendations.reduce((acc, rec) => acc + rec.score, 0) /
                        recommendations.length /
                        5) *
                      100
                    ).toFixed(1)}
                    %
                  </Badge>
                )}
              </HStack>
            </VStack>
          </HStack>

          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(mint.url)}
            disabled={isDisabled}
            size={24}
            variant="success"
          />
        </HStack>
      </TouchableOpacity>
    </View>
  );
};

const AddRoute = () => {
  const { getPrimaryColor } = useTheme();
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getBalances } = useMintManagement();

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());

  // Search functionality
  const {
    url,
    setUrl,
    validationState,
    reset,
    mintInfo: customMintInfo,
  } = useDebouncedMintValidation(800);

  // Get owned mint URLs to exclude from discovery
  const [ownedMintUrls, setOwnedMintUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadOwnedMints = async () => {
      const balances = await getBalances();
      setOwnedMintUrls(new Set(Object.keys(balances)));
    };
    loadOwnedMints();
  }, [getBalances]);

  // Use the discovered mints hook
  const {
    mints: discoveredMints,
    loading,
    error,
    retry,
  } = useDiscoveredMints({
    excludeUrls: ownedMintUrls,
  });

  // Get allowed currencies from payload or use defaults
  const allowedCurrencies = payload?.allowedUnits ?? ['SAT', 'USD', 'EUR', 'GBP'];

  // Filter mints based on search query
  const filteredMints = useMemo((): SearchableMint[] => {
    // Convert discovered mints to searchable format
    const searchableDiscoveredMints = discoveredMints.map(adaptDiscoveredMint);

    if (!url.trim()) return searchableDiscoveredMints;

    const filtered = filterMints(searchableDiscoveredMints, url);

    // If the search query looks like a URL and doesn't match any existing mints,
    // add a pseudo mint for the custom URL
    if (looksLikeMintUrl(url) && !filtered.some((mint) => mint.url === url)) {
      const pseudoMint: PseudoMint = {
        url,
        isPseudoMint: true,
        mintInfo: customMintInfo,
        name: url.replace('https://', '').split('/')[0],
      };
      return [pseudoMint, ...filtered];
    }

    return filtered;
  }, [discoveredMints, url, customMintInfo]);

  const handleToggleMint = (url: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleSelectCustomMint = () => {
    if (!url.trim()) {
      showMessage({ message: 'Please enter a mint URL', type: 'warning' });
      return;
    }

    if (!looksLikeMintUrl(url)) {
      showMessage({ message: 'Please enter a valid mint URL', type: 'warning' });
      return;
    }

    // Just select/check the mint - it will be added when user clicks the main "Add" button
    setSelectedMints((prev) => new Set([...prev, url]));
    showMessage({ message: 'Mint selected for addition', type: 'success' });
    reset();
  };

  const handleSave = async () => {
    if (selectedMints.size === 0) {
      showMessage({ message: 'Please select at least one mint to add', type: 'warning' });
      return;
    }

    try {
      console.log('🚀 Starting to add selected mints:', Array.from(selectedMints));

      if (!CocoManager.isInitialized()) {
        console.error('❌ CocoManager not initialized');
        showMessage({ message: 'Manager not initialized. Please try again.', type: 'error' });
        return;
      }

      const manager = CocoManager.getInstance();
      const results = [];
      const errors = [];

      for (const mintUrl of selectedMints) {
        try {
          console.log(`🔍 Adding mint: ${mintUrl}`);
          const result = await manager.mint.addMint(mintUrl);
          console.log(`✅ Added mint ${mintUrl}:`, result);
          results.push(mintUrl);

          try {
            const mintInfo = await manager.mint.getMintInfo(mintUrl);
            console.log(`✅ Mint info loaded for ${mintUrl}:`, mintInfo);
          } catch (infoError) {
            console.warn(`⚠️ Failed to load mint info for ${mintUrl}:`, infoError);
          }
        } catch (err) {
          console.error(`❌ Failed to add mint ${mintUrl}:`, err);
          errors.push({ mintUrl, error: err });
        }
      }

      if (errors.length === 0) {
        showMessage({ message: `Successfully added ${results.length} mint(s)`, type: 'success' });
      } else if (results.length > 0) {
        showMessage({
          message: `Added ${results.length} mint(s), ${errors.length} failed`,
          type: 'warning',
        });
      } else {
        showMessage({ message: 'Failed to add any mints. Please try again.', type: 'error' });
        return;
      }

      sheetRef.current?.hide({
        id: 'add-mints',
        name: 'Add Mints',
        iconUrl: null,
        unit: 'sat',
      });
    } catch (err) {
      console.error('❌ Failed to add mints:', err);
      showMessage({ message: 'Failed to add mints. Please try again.', type: 'error' });
    }
  };

  // Loading state component for the mints section
  const LoadingMintsList = () => (
    <VStack className="items-center p-8">
      <ActivityIndicator size="large" color={getPrimaryColor('0')} />
      <Spacer size={12} />
      <Text className="text-center text-sm" style={{ color: getPrimaryColor('200') }}>
        Discovering mints...
      </Text>
    </VStack>
  );

  if (loading) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <VStack spacing={16}>
          <MintSearchInput
            value={url}
            onChangeText={setUrl}
            validationState={validationState}
            onAddMint={handleSelectCustomMint}
            canAddMint={url.trim().length > 0}
          />

          <MintCurrencySelector
            mints={[]}
            allowedCurrencies={allowedCurrencies}
            currencyLabel="Currency options"
            mintsLabel="Discovered mints"
            renderItem={() => null}
            customEmptyState={<LoadingMintsList />}
            isLoading={true}
          />
        </VStack>
      </Wrapper>
    );
  }

  if (error) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Retry',
                variant: 'primary',
                onPress: async () => retry(),
              },
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <VStack className="items-center p-5">
          <Text className="text-center text-base" style={{ color: getPrimaryColor('200') }}>
            {error}
          </Text>
        </VStack>
      </Wrapper>
    );
  }

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: `Add (${selectedMints.size})`,
              variant: 'primary',
              onPress: handleSave,
              disabled: selectedMints.size === 0,
            },
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => sheetRef.current?.hide(),
            },
          ]}
        />
      }>
      <VStack spacing={16}>
        <MintSearchInput
          value={url}
          onChangeText={setUrl}
          validationState={validationState}
          onAddMint={handleSelectCustomMint}
          canAddMint={url.trim().length > 0}
        />

        <MintCurrencySelector
          mints={filteredMints as any[]}
          allowedCurrencies={allowedCurrencies}
          currencyLabel="Currency options"
          mintsLabel={url.trim() ? 'Search results' : 'Discovered mints'}
          renderItem={(mint: any) => (
            <AddMintItem
              mint={mint}
              onToggle={handleToggleMint}
              selected={selectedMints.has(mint.url)}
            />
          )}
        />
      </VStack>
    </Wrapper>
  );
};

export default AddRoute;
