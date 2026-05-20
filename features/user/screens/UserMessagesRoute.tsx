/**
 * @fileoverview Canonical thin wrapper for the UserMessages routes.
 *
 * `app/userMessages.tsx`, `app/(user-flow)/userMessages.tsx`, and
 * `app/(mint-flow)/userMessages.tsx` previously each carried their own
 * copy of the param schema, a near-identical render body, and one of two
 * variant `onBack` handlers (omitted vs explicit `() => router.back()`,
 * which is also UserMessagesScreen's default). Per audit 50 F-009 the
 * three were functionally indistinguishable; the duplicate routes only
 * exist because Expo Router ties group membership to file location.
 *
 * Each route now re-exports this default and Expo Router still resolves
 * group-specific deep-links — but there's exactly one schema + render
 * body to maintain.
 */

import React from 'react';
import { z } from 'zod';

import { Hex64 } from '@/shared/lib/nav/routeSchemas';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

import { UserMessagesScreen } from './UserMessagesScreen';

const ParamsSchema = z.object({
  pubkey: Hex64,
});

export default function UserMessagesRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'userMessages' });
  if (!params) return null;
  return <UserMessagesScreen pubkey={params.pubkey} />;
}
