/**
 * @fileoverview Transactions flow mintQuote route wrapper
 *
 * Part of the (transactions-flow) modal group — displays with back button.
 * Validates the `mintHistoryEntry` param at the route boundary per
 * AUDIT.md dim-5 (audit 23#F-002): unguarded `JSON.parse(...)` was the
 * crash + invoice-spoofing surface. The validated string is passed
 * through to MintQuoteScreen, which decodes it via useScreenActions.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { MintQuoteScreen } from '@/features/receive';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'transactions-flow.mintQuote' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <MintQuoteScreen mintHistoryEntry={params.mintHistoryEntry} />
    </>
  );
}

export default ModalScreen;
