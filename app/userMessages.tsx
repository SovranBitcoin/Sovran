/**
 * @fileoverview Standalone User Messages route wrapper
 *
 * Used for direct navigation and deep linking. For flow-based navigation
 * with horizontal stack, use (mint-flow)/userMessages.
 *
 * Validates the deep-link `pubkey` at the route boundary per AUDIT.md
 * dim-5 — `pubkey` is forwarded to UserMessagesScreen as the NIP-17 DM
 * counterparty.
 */

import React from 'react';
import { z } from 'zod';
import { UserMessagesScreen } from '@/features/user';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/, 'pubkey must be 64-hex'),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.userMessages' });
  if (!params) return null;

  return <UserMessagesScreen pubkey={params.pubkey} />;
}

export default ModalScreen;
