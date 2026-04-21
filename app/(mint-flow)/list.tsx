/**
 * @fileoverview Mint List screen for Mint Flow
 *
 * General mint management modal — not driven by a payment flow.
 * Builds MintListItem[] from live data (useMints + useBalanceContext + cached stores)
 * via buildMintListItems so MintListScreen stays hook-free.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useBalanceContext, useMints } from '@cashu/coco-react';
import type { MintAvailability } from 'coco-payment-ux';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { MintListScreen } from '@/features/mint';
import { buildMintListItems } from '@/features/send';
import Icon from 'assets/icons';

function MintListRoute() {
  const foreground = useThemeColor('foreground');
  const params = useLocalSearchParams<{
    showAddMintsButton?: string;
    showDetailsButton?: string;
    onSelectAction?: string;
    continuePathname?: string;
    continueParams?: string;
  }>();

  const showAddMintsButton = params.showAddMintsButton !== 'false';
  const showDetailsButton = params.showDetailsButton !== 'false';
  const onSelectAction = params.onSelectAction || 'goBack';

  const { trustedMints } = useMints();
  const { balance: mintBalances } = useBalanceContext();

  // Force list rebuild when this screen regains focus (e.g. after adding a mint)
  const [focusKey, setFocusKey] = useState(0);
  useFocusEffect(useCallback(() => { setFocusKey((k) => k + 1); }, []));

  // Build a neutral availability array (all mints available, no flow constraints).
  const availability = useMemo<MintAvailability[]>(
    () =>
      trustedMints.map((m) => ({
        mintUrl: m.mintUrl,
        balance: mintBalances[m.mintUrl] ?? 0,
        status: 'available' as const,
        reason: null,
        isPreferred: false,
      })),
    [trustedMints, mintBalances]
  );

  const items = useMemo(
    () => buildMintListItems(trustedMints, availability),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trustedMints, availability, focusKey]
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerRight: () =>
            showAddMintsButton ? (
              <Link href="/add" asChild>
                <TouchableOpacity style={{ padding: 8 }}>
                  <Icon name="fluent:add-24-filled" size={24} color={foreground} />
                </TouchableOpacity>
              </Link>
            ) : null,
        }}
      />

      <MintListScreen
        items={items}
        showDetailsButton={showDetailsButton}
        closeButtonLabel="Close"
        onMintSelect={(item) => {
          if (onSelectAction === 'continue' && params.continuePathname) {
            const continueParams = params.continueParams ? JSON.parse(params.continueParams) : {};
            router.navigate({
              pathname: params.continuePathname as any,
              params: {
                ...continueParams,
                unit: item.unit,
              },
            });
          } else {
            router.dismiss();
          }
        }}
        onInspectMint={(mintUrl) => {
          router.navigate({
            pathname: '/info',
            params: { mintUrl },
          });
        }}
        onClose={() => router.back()}
      />
    </>
  );
}

export default MintListRoute;
