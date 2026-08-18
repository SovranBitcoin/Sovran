/**
 * @fileoverview Canonical Onchain send route shell.
 */

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';

import { paymentLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

import { OnchainSendScreen } from './OnchainSendScreen';

const ParamsSchema = z.object({
  meltHistoryEntry: z.string().min(1).max(64_000).optional(),
});

interface OnchainSendRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'send-flow.onchainSend'`. */
  where: string;
}

export function OnchainSendRoute({ where }: OnchainSendRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;
  paymentLog.info('send.onchain.route_ready', {
    where,
    meltHistoryEntryLength: params.meltHistoryEntry?.length ?? 0,
    hasMeltHistoryEntry: !!params.meltHistoryEntry,
  });

  return (
    <OnchainSendScreen
      key={params.meltHistoryEntry}
      meltHistoryEntry={params.meltHistoryEntry}
      onCancel={() => {
        router.dismissTo('/');
      }}
    />
  );
}
