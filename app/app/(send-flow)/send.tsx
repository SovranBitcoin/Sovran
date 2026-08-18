/**
 * @fileoverview Send flow entry route — thin wrapper around SendScreen.
 *
 * The destination-first front door: reached when the wallet Send button drives
 * the Colada machine to the `selectDestination` step. Validates the `unit`
 * param at the route boundary; the screen owns method selection, the
 * destination input, and contact search.
 */

import { z } from 'zod';

import { SendScreen } from '@/features/send/screens/SendScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  unit: z.string().min(1).max(16).default('sat'),
});

function SendRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'send-flow.send' });
  if (!params) return null;

  return <SendScreen unit={params.unit} />;
}

export default SendRoute;
