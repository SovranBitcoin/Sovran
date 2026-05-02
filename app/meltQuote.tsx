/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * Used for direct navigation and deep linking. Validates the
 * `meltHistoryEntry` param at the route boundary per AUDIT.md dim-5
 * (audit 23#F-002): the param is JSON-encoded and was previously forwarded
 * raw to the screen for `JSON.parse`. The bound caps DoS potential while
 * still admitting the empty-state "create new melt" flow (param absent).
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { MeltQuoteScreen } from '@/features/send';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  meltHistoryEntry: z.string().min(1).max(64_000).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.meltQuote' });
  if (!params) return null;

  return (
    <MeltQuoteScreen
      meltHistoryEntry={params.meltHistoryEntry}
      onCancel={() => {
        router.dismissTo('/');
      }}
    />
  );
}

export default ModalScreen;
