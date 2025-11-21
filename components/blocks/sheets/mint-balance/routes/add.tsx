/**
 * @fileoverview AddRoute - Discover and add new mints
 *
 * @module components/blocks/sheets/mint-balance/routes/add
 *
 * @description
 * Discovers available mints, allows custom URL entry, and adds selected mints to wallet.
 * Users can search discovered mints, add custom URLs, and select multiple mints for addition.
 *
 * **Navigation:**
 * - From: `router.navigate('add')` from list route
 * - To: `router.goBack()` after successful addition
 * - Close: `sheetRef.current?.hide({payload: result})`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Allowed currencies and configuration
 * - Params: None (direct navigation)
 *
 * **Flow:** Load discovered mints → search/filter → select mints → add to wallet → close
 *
 * @see {@link ./list}
 * @see {@link ./info}
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { popup } from '@/helper/popup';
import { View, VStack } from 'components/ui/View';
import { MintCurrencySelector } from '../MintCurrencySelector';
import { MintSearchInput } from 'components/ui/MintSearchInput';
import { useDebouncedMintValidation } from 'hooks/coco/useDebouncedMintValidation';
import { filterMints, looksLikeMintUrl } from 'helper/fuzzySearch';
import { extractDomain } from '@/helper/url';
import { CocoManager } from 'helper/coco/manager';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNostrDiscoveredMints } from '@/hooks/coco/useNostrDiscoveredMints';
import { useMintManagement } from 'hooks/coco';
import type { NostrDiscoveredMintData } from '@/hooks/coco/useNostrDiscoveredMints';
import { MintItem } from './list';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { Mint } from 'coco-cashu-core';

interface PseudoMint {
  url: string;
  isPseudoMint: true;
  mintInfo?: any;
  name?: string;
}

// Extend NostrDiscoveredMintData to include name for compatibility with filterMints
interface SearchableDiscoveredMint extends NostrDiscoveredMintData {
  name: string;
  auditInfo?: {
    score: number;
    auditorData: {
      name: string;
      state: string;
    };
    recommendations: any[];
  };
}

type SearchableMint = SearchableDiscoveredMint | PseudoMint;

const isPseudoMint = (mint: SearchableMint): mint is PseudoMint => {
  return 'isPseudoMint' in mint && mint.isPseudoMint === true;
};

// Convert NostrDiscoveredMintData to SearchableDiscoveredMint
const adaptDiscoveredMint = (mint: NostrDiscoveredMintData): SearchableDiscoveredMint => {
  return {
    ...mint,
    name: mint.mintInfo?.name || extractDomain(mint.url),
    // Map Nostr data to expected structure for backward compatibility
    auditInfo: {
      score: mint.score,
      auditorData: {
        name: mint.mintInfo?.name || extractDomain(mint.url),
        state: mint.mintInfo ? 'OK' : 'OFFLINE',
      },
      recommendations: [], // Nostr events don't have sub-recommendations
    },
  };
};

// Loading state component for the mints section
const LoadingMintsList = ({ count = 5 }: { count?: number }) => {
  return (
    <VStack spacing={0}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className="bg-primary-900"
          style={{
            padding: 16,
            marginBottom: 4,
            borderRadius: 16,
          }}>
          <VStack gap={12}>
            <View className="flex-row items-center gap-3">
              <Skeleton
                className="h-[42px] w-[42px] bg-primary-700"
                style={{ borderRadius: 42 * 0.25 }}
              />
              <VStack flex={1} gap={8}>
                <Skeleton className="h-[16px] bg-primary-700" style={{ width: 150 }} />
                <Skeleton className="h-[20px] rounded-full bg-primary-700" style={{ width: 80 }} />
              </VStack>
            </View>
            <View className="flex-row gap-2">
              <Skeleton className="h-[24px] rounded-full bg-primary-700" style={{ width: 56 }} />
              <Skeleton className="h-[24px] rounded-full bg-primary-700" style={{ width: 60 }} />
            </View>
          </VStack>
        </View>
      ))}
    </VStack>
  );
};

/**
 * AddRoute Component
 *
 * @component
 * @param {RouteScreenProps<'mint-balance', 'add'>} props
 * @returns {JSX.Element}
 */
const AddRoute = () => {
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getPrimaryColor } = useTheme();

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  // Search functionality
  const {
    url,
    setUrl,
    validationState,
    reset,
    mintInfo: customMintInfo,
  } = useDebouncedMintValidation(800);

  // Use the Nostr discovered mints hook
  const { mints: discoveredMints, loading, error, retry } = useNostrDiscoveredMints();
  // return (
  //   <View>
  //     <Text>
  //       {JSON.stringify(discoveredMints, null, 2)}
  //       {String(loading)}
  //       {String(error)}
  //     </Text>
  //   </View>
  // );
  // Get known mints for filtering
  const { mints: knownMints } = useMintManagement();

  // Get allowed currencies from payload or use defaults
  const allowedCurrencies = payload?.allowedUnits ?? ['SAT', 'USD', 'EUR', 'GBP'];

  // Helper function to normalize URLs for comparison
  const normalizeUrl = useCallback((url: string): string => {
    // Remove trailing slash and normalize
    return url.replace(/\/$/, '');
  }, []);

  // Filter mints based on search query and exclude known mints
  const filteredMints = useMemo((): SearchableMint[] => {
    // Get known mint URLs for exclusion (normalized)
    const knownMintUrls = new Set(knownMints.map((mint) => normalizeUrl(mint.mintUrl)));

    // Convert discovered mints to searchable format and exclude known mints
    const searchableDiscoveredMints = discoveredMints
      .filter((mint) => {
        const normalizedDiscoveredUrl = normalizeUrl(mint.url);
        const isKnown = knownMintUrls.has(normalizedDiscoveredUrl);
        return !isKnown;
      })
      .map(adaptDiscoveredMint);

    if (!url.trim()) return searchableDiscoveredMints;

    const filtered = filterMints(searchableDiscoveredMints, url);

    // If the search query looks like a URL and doesn't match any existing mints,
    // add a pseudo mint for the custom URL
    if (looksLikeMintUrl(url) && !filtered.some((mint) => mint.url === url)) {
      const pseudoMint: PseudoMint = {
        url,
        isPseudoMint: true,
        mintInfo: customMintInfo,
        name: extractDomain(url),
      };
      return [pseudoMint, ...filtered];
    }

    return filtered;
  }, [discoveredMints, knownMints, url, customMintInfo, normalizeUrl]);

  // Fetch KYM scores for all mints in a single batch
  const mintUrls = useMemo(() => filteredMints.map((mint) => mint.url), [filteredMints]);
  const { scores: kymScores, loading: kymLoading } = useKYMMints(mintUrls);

  const handleToggleMint = useCallback((url: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  const handleSelectCustomMint = () => {
    if (!url.trim()) {
      popup({ message: 'Please enter a mint URL', type: 'warning' });
      return;
    }

    if (!looksLikeMintUrl(url)) {
      popup({ message: 'Please enter a valid mint URL', type: 'warning' });
      return;
    }

    // Just select/check the mint - it will be added when user clicks the main "Add" button
    setSelectedMints((prev) => new Set([...prev, url]));
    popup({ message: 'Mint selected for addition', type: 'success' });
    reset();
  };

  /**
   * Handles mint addition
   *
   * @async
   * @description Adds selected mints to wallet via CocoManager, shows progress, closes sheet
   *
   * **Process:** validate → addMint() for each → show results → sheetRef.hide()
   * **Effects:** Wallet updates, popup notifications, sheet close
   */
  const handleSave = async () => {
    if (selectedMints.size === 0) {
      popup({ message: 'Please select at least one mint to add', type: 'warning' });
      return;
    }

    if (isAdding) {
      console.warn('⚠️ Already adding mints, ignoring duplicate request');
      return;
    }

    setIsAdding(true);

    try {
      if (!CocoManager.isInitialized()) {
        console.error('❌ CocoManager not initialized');
        popup({ message: 'Manager not initialized. Please try again.', type: 'error' });
        setIsAdding(false);
        return;
      }

      const manager = CocoManager.getInstance();
      const results = [];
      const errors = [];
      const mintUrls = Array.from(selectedMints);

      console.log(`🔄 Starting to add ${mintUrls.length} mint(s):`, mintUrls);

      // Process mints sequentially with a small delay to avoid race conditions
      for (let i = 0; i < mintUrls.length; i++) {
        const mintUrl = mintUrls[i];
        console.log(`📌 Processing mint ${i + 1}/${mintUrls.length}: ${mintUrl}`);

        try {
          // Trust the mint
          await manager.mint.trustMint(mintUrl);
          console.log(`✅ Successfully trusted mint: ${mintUrl}`);
          results.push(mintUrl);

          // Try to fetch mint info (non-critical, so we don't fail if this errors)
          try {
            await manager.mint.getMintInfo(mintUrl);
            console.log(`✅ Successfully fetched mint info: ${mintUrl}`);
          } catch (infoErr) {
            console.warn(`⚠️ Failed to fetch mint info for ${mintUrl}:`, infoErr);
            // Don't add to errors since trustMint succeeded
          }

          // Add a small delay between operations to avoid potential race conditions
          if (i < mintUrls.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (err) {
          console.error(`❌ Failed to add mint ${mintUrl}:`, err);
          errors.push({
            mintUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      console.log(`📊 Results: ${results.length} succeeded, ${errors.length} failed`);

      if (errors.length === 0) {
        popup({ message: `Successfully added ${results.length} mint(s)`, type: 'success' });
        sheetRef.current?.hide();
      } else if (results.length > 0) {
        popup({
          message: `Added ${results.length} mint(s), ${errors.length} failed`,
          type: 'warning',
        });
        // Still close the sheet if some succeeded
        sheetRef.current?.hide();
      } else {
        const errorMessages = errors
          .map((e) => `${extractDomain(e.mintUrl)}: ${e.error}`)
          .join(', ');
        console.error('❌ All mints failed:', errors);
        popup({
          message: `Failed to add any mints: ${errorMessages}`,
          type: 'error',
        });
        // Don't close the sheet if all failed, so user can retry
      }
    } catch (err) {
      console.error('❌ Failed to add mints:', err);
      popup({
        message: `Failed to add mints: ${err instanceof Error ? err.message : String(err)}`,
        type: 'error',
      });
    } finally {
      setIsAdding(false);
    }
  };

  // Render item callback for MintCurrencySelector
  const renderMintItem = useCallback(
    (mint: SearchableMint, _selectedCurrency: string) => {
      const pseudo = isPseudoMint(mint);
      const normalizedUrl = normalizeUrl(mint.url);
      const kymData = kymScores[normalizedUrl];
      const kymScore = kymData?.score;

      // Create a compatible mint object for MintItem
      const mintObject: Mint = {
        mintUrl: mint.url,
        mintInfo: pseudo ? mint.mintInfo : mint.mintInfo ? mint.mintInfo : undefined,
      } as Mint;

      return (
        <MintItem
          key={mint.url}
          mint={mintObject}
          mintUrl={mint.url}
          balance={undefined}
          showCheckbox={true}
          selected={selectedMints.has(mint.url)}
          onToggle={() => handleToggleMint(mint.url)}
          onPress={() => handleToggleMint(mint.url)}
          isLoading={false}
          globalLoading={isAdding}
          kymScore={kymScore}
          kymLoading={kymLoading}
          showDetailsButton={false}
        />
      );
    },
    [selectedMints, handleToggleMint, isAdding, kymScores, kymLoading, normalizeUrl]
  );

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
              text: isAdding ? 'Adding...' : `Add (${selectedMints.size})`,
              variant: 'primary',
              onPress: handleSave,
              disabled: selectedMints.size === 0 || isAdding,
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

        <VStack spacing={0}>
          <MintCurrencySelector
            mints={filteredMints as any[]}
            allowedCurrencies={allowedCurrencies}
            currencyLabel="Currency options"
            mintsLabel={url.trim() ? 'Search results' : 'Discovered mints'}
            renderItem={renderMintItem}
            customEmptyState={loading ? <LoadingMintsList /> : undefined}
            isLoading={loading}
          />
        </VStack>
      </VStack>
    </Wrapper>
  );
};

export default AddRoute;
