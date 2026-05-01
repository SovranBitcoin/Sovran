/**
 * @fileoverview Mint List screen for Mint Flow
 *
 * General mint management modal — not driven by a payment flow.
 * Builds MintListItem[] from live data (useMints + useBalanceContext) plus
 * the bulk catalog from `getMintCatalog`, the same source coco-payment-ux
 * uses for Send / Receive Select Mint.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { useBalanceContext, useMints } from '@cashu/coco-react';
import type { MintAvailability } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { useMintCatalog } from '@/features/mint/hooks/useMintCatalog';
import { buildMintListItems } from '@/features/send';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { cashuLog } from '@/shared/lib/logger';

function MintListRoute() {
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
  const { balances } = useBalanceContext();
  const mintBalances = balances.byMint;

  // Force list rebuild when this screen regains focus (e.g. after adding a mint)
  const [focusKey, setFocusKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setFocusKey((k) => k + 1);
      cashuLog.info('mint.list.refocus', {
        trustedMintCount: trustedMints.length,
      });
    }, [trustedMints.length])
  );

  // Build a neutral availability array (all mints available, no flow constraints).
  const availability = useMemo<MintAvailability[]>(
    () =>
      trustedMints.map((m) => ({
        mintUrl: m.mintUrl,
        balance: mintBalances[m.mintUrl]?.total ?? 0,
        status: 'available' as const,
        reason: null,
        isPreferred: false,
      })),
    [trustedMints, mintBalances]
  );

  // One bulk fetch — same source coco-payment-ux uses for Select Mint, so
  // the audit / score pills render identically across both surfaces.
  const mintUrls = useMemo(() => trustedMints.map((m) => m.mintUrl), [trustedMints]);
  const catalog = useMintCatalog(mintUrls);

  const items = useMemo(
    () => buildMintListItems(trustedMints, availability, catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trustedMints, availability, catalog, focusKey]
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
                <ScreenHeaderAction icon="fluent:add-24-filled" onPress={() => {}} />
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
