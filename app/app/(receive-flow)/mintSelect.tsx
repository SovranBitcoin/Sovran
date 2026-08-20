/**
 * @fileoverview Receive flow mint-select route — thin wrapper around MintSelectFlowScreen.
 *
 * Validates the `mintSelectorEntry` deep-link param at the route boundary
 * per AUDIT.md dim-5 — the param is a JSON-encoded entry decoded by
 * `useScreenActions`.
 */

import { z } from 'zod';

import { MintSelectFlowScreen } from '@/features/mint/screens/MintSelectFlowScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintSelectorEntry: z.string().min(1).max(64_000).optional(),
});

function ReceiveMintSelectRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.mintSelect' });
  if (!params) return null;

  return <MintSelectFlowScreen flow="receive" mintSelectorEntry={params.mintSelectorEntry} />;
}

export default ReceiveMintSelectRoute;
