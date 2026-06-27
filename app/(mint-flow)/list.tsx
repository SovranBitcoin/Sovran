/**
 * @fileoverview Mint List screen for Mint Flow
 *
 * General mint management modal — not driven by a payment flow.
 * Builds MintListItem[] from live data (useMints + useBalanceContext) plus
 * the bulk catalog from `getMintCatalog`, the same source colada
 * uses for Send / Receive Select Mint.
 *
 * Validates the deep-link `continueParams` (JSON-encoded) and the
 * `continuePathname` / `onSelectAction` routing flags at the route
 * boundary per AUDIT.md dim-5 — `continueParams` is fed to JSON.parse.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Stack, Link } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useFocusEffect } from 'expo-router/react-navigation';
import { z } from 'zod';

import { useBalanceContext, useMints } from '@cashu/coco-react';
import type { MintAvailability } from '@sovranbitcoin/colada';

import { MintListScreen } from '@/features/mint';
import { useMintCatalog } from '@/features/mint/hooks/useMintCatalog';
import { buildMintListItems } from '@/features/send';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { cashuLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  showAddMintsButton: z.enum(['true', 'false']).optional(),
  showDetailsButton: z.enum(['true', 'false']).optional(),
  onSelectAction: z.enum(['goBack', 'continue']).optional(),
  continuePathname: z
    .string()
    .max(256)
    .regex(/^\/[A-Za-z0-9/_()[\]-]*$/, 'continuePathname must be an internal route')
    .optional(),
  continueParams: z.string().min(1).max(4_000).optional(),
});

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function MintListRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.list' });

  const showAddMintsButton = params?.showAddMintsButton !== 'false';
  const showDetailsButton = params?.showDetailsButton !== 'false';
  const onSelectAction = params?.onSelectAction ?? 'goBack';

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
        balance: amountToNumber(mintBalances[m.mintUrl]?.total),
        status: 'available' as const,
        reason: null,
        isPreferred: false,
      })),
    [trustedMints, mintBalances]
  );

  // One bulk fetch — same source colada uses for Select Mint, so
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
          cashuLog.info('mint.list.select', {
            ...mintUrlLogFields(item.mintUrl),
            unit: item.unit,
            onSelectAction,
            hasContinuePathname: !!params?.continuePathname,
          });
          if (onSelectAction === 'continue' && params?.continuePathname) {
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
          cashuLog.info('mint.list.inspect', {
            ...mintUrlLogFields(mintUrl),
          });
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
