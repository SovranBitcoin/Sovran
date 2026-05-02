/**
 * @fileoverview Standalone mintQuote route wrapper
 *
 * Used for direct navigation and deep linking. Validates the
 * `mintHistoryEntry` param at the route boundary per AUDIT.md dim-5
 * (audit 23#F-002): the param is JSON-encoded and was previously fed to
 * an unguarded `JSON.parse(...)` cast, which both crashes the screen on
 * malformed input and lets attacker-crafted invoices be rendered as the
 * user's own. The validated string is passed through to MintQuoteScreen,
 * which itself decodes via useScreenActions — matching the
 * (receive-flow)/mintQuote sister route's behaviour.
 */

import React from 'react';
import { z } from 'zod';
import { MintQuoteScreen } from '@/features/receive';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.mintQuote' });
  if (!params) return null;
  return <MintQuoteScreen mintHistoryEntry={params.mintHistoryEntry} />;
}

export default ModalScreen;
