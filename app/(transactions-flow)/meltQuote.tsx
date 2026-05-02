/**
 * @fileoverview Transactions flow meltQuote route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 *
 * Validates the `meltHistoryEntry` deep-link param at the route boundary
 * per AUDIT.md dim-5 (audit 23#F-002): the param is JSON-encoded and was
 * previously forwarded raw to a `JSON.parse(...)` cast.
 */

import React from 'react';
import { router, Stack } from 'expo-router';
import { z } from 'zod';
import { MeltQuoteScreen } from '@/features/send';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  meltHistoryEntry: z.string().min(1).max(64_000).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'transactions-flow.meltQuote' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          headerBackButtonMenuEnabled: false,
        }}
      />
      <MeltQuoteScreen
        meltHistoryEntry={params.meltHistoryEntry}
        onCancel={() => {
          router.dismissTo('/');
        }}
      />
    </>
  );
}

export default ModalScreen;
