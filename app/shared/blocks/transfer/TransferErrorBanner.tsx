/**
 * @fileoverview Reusable error banner for transfer cards
 *
 * The app's soft-danger `Notice` at the geometry a transfer card expects:
 * inset from the card's gutter, tight vertical padding, small corners. Used by
 * SwapTransactionScreen, RebalanceStepRow and RebalanceChainCard.
 *
 * It stays a named component rather than a bare `Notice` at each call site so
 * the four transfer surfaces keep one geometry and one `Log` probe.
 */

import React from 'react';
import { Notice } from '@/shared/ui/composed/Notice';
import { Log } from '@/shared/lib/logger';

interface TransferErrorBannerProps {
  /** Error message to display */
  message: string;
}

export const TransferErrorBanner = React.memo(({ message }: TransferErrorBannerProps) => (
  <Log name="TransferErrorBanner">
    <Notice
      status="danger"
      tone="soft"
      size="compact"
      description={message}
      className="mx-4 mb-2 items-center rounded-md py-2"
    />
  </Log>
));
TransferErrorBanner.displayName = 'TransferErrorBanner';
