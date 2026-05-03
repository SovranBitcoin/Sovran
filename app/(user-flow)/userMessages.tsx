/**
 * @fileoverview User Flow Messages Screen
 *
 * Part of the (user-flow) modal group. Displays a direct messaging
 * interface for contacting users. Navigates horizontally within the
 * user flow modal.
 *
 * Deep-link params are validated with Zod at the route boundary per
 * AUDIT.md dim-5 — `pubkey` becomes the NIP-17 DM counterparty so a
 * malformed value would otherwise be silently encrypted-to.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';
import { UserMessagesScreen } from '@/features/user';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  pubkey: Hex64,
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'user-flow.userMessages' });
  if (!params) return null;

  return <UserMessagesScreen pubkey={params.pubkey} onBack={() => router.back()} />;
}

export default ModalScreen;
