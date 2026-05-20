/**
 * @fileoverview Receive flow amount route — mint quote amount entry.
 *
 * Validates the `amountEntry` deep-link param at the route boundary per
 * AUDIT.md dim-5 — the param is a JSON-encoded entry that the screen
 * decodes via `useScreenActions`.
 */

import React from 'react';
import { z } from 'zod';

import { AmountFlowScreen } from '@/features/send/screens/AmountFlowScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  amountEntry: z.string().min(1).max(64_000).optional(),
});

function ReceiveAmountRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.amount' });
  if (!params) return null;

  return <AmountFlowScreen amountEntry={params.amountEntry} />;
}

export default ReceiveAmountRoute;
