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
import { Stack, Link, useFocusEffect } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';

import { useBalanceContext, useMints } from '@cashu/coco-react';
import type { MintAvailability } from 'wallet';

import { MintListScreen, useMintRowsWithCache } from '@/features/mint';
import { useMintCatalog } from '@/features/mint/hooks/useMintCatalog';
import { buildMintListItems } from '@/features/send';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withGlassHeaderItems } from '@/navigation/headerItems';
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
  // MintListScreen paints its canvas `surface`; declare that to the Android
  // sheet header so its scrim fades from `surface`, not the darker theme
  // `background`. Must be set here explicitly — this inline <Stack.Screen>
  // re-applies its options every render, which would otherwise clobber the
  // one-shot bgColor→header auto-sync in the Screen component.
  const surface = useThemeColor('surface');

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
  // Trusted mints are known + catalog-enriched here, so treat every row as
  // `live` (no skeleton); the cache overlay backfills holes and animates stats.
  const { rows } = useMintRowsWithCache({ baseItems: items, itemsStatus: 'ready' });

  return (
    <>
      <Stack.Screen
        options={withGlassHeaderItems({
          title: 'Select Mint',
          headerTransparent: true,
          headerStyle: { backgroundColor: surface },
          headerRight: () =>
            showAddMintsButton ? (
              <Link href="/add" asChild>
                <ScreenHeaderAction icon="fluent:add-24-filled" onPress={() => {}} />
              </Link>
            ) : null,
        })}
      />

      <MintListScreen
        items={rows}
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
          // Pass the mint as the screen's `mintInfoEntry` seed (the param its
          // schema actually reads), not a bare `mintUrl` the screen ignores —
          // otherwise MintInfoScreen opens with no mint and resolves it from
          // whatever the machine context happens to hold. Seeding only the URL
          // (no displayName) lets the bridge fill audit/KYM from cache
          // instantly and still fetch NUT-06 details (name/contact/MOTD).
          router.navigate({
            pathname: '/info',
            params: { mintInfoEntry: JSON.stringify({ mintUrl }) },
          });
        }}
        onClose={() => router.back()}
      />
    </>
  );
}

export default MintListRoute;
