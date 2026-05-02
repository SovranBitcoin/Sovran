/**
 * @fileoverview Mint Flow User Messages Screen
 *
 * Part of the (mint-flow) modal group.
 * Displays a direct messaging interface for contacting mint operators.
 * Navigates horizontally within the mint flow modal.
 *
 * Validates the deep-link `pubkey` recipient at the route boundary per
 * AUDIT.md dim-5 — `pubkey` selects the encryption target for outgoing
 * DMs, so it must be a 64-hex Schnorr key, not arbitrary text.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { UserMessagesScreen } from '@/features/user';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/, 'pubkey must be 64-hex'),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.userMessages' });
  if (!params) return null;

  const handleBack = () => {
    router.back();
  };

  return <UserMessagesScreen pubkey={params.pubkey} onBack={handleBack} />;
}

export default ModalScreen;
