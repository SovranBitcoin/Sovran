import { useEffect, useState } from 'react';

import { useManagerContext } from '@cashu/coco-react';

import { cashuLog } from '@/shared/lib/logger';

/**
 * A melt quote's expiry (unix seconds), read once from the LOCAL quote row:
 * no mint request. Undefined until read, and for a quote this wallet has no
 * row for. The value belongs to the quote it was read for, never to the next
 * one, so a stale expiry is not drawn on another payment.
 */
export function useMeltQuoteExpiry(
  mintUrl: string | null | undefined,
  quoteId: string | null | undefined
): number | undefined {
  const { manager } = useManagerContext();
  const key = mintUrl && quoteId ? `${mintUrl}|${quoteId}` : null;
  const [read, setRead] = useState<{ key: string; expiry: number | undefined } | null>(null);

  useEffect(() => {
    if (!manager || !mintUrl || !quoteId || !key) return;
    let mounted = true;
    manager.quotes.melt
      .get({ mintUrl, quoteId })
      .then((quote) => {
        const expiry = (quote as { expiry?: unknown } | null)?.expiry;
        if (mounted) {
          setRead({ key, expiry: typeof expiry === 'number' && expiry > 0 ? expiry : undefined });
        }
      })
      .catch((error: unknown) => {
        cashuLog.warn('send.melt_quote.expiry_read_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      mounted = false;
    };
  }, [manager, mintUrl, quoteId, key]);

  return read && read.key === key ? read.expiry : undefined;
}
