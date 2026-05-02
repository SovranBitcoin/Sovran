import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWhitenoise } from '../WhitenoiseContext';
import { WhitenoiseDmIndex, type WhitenoiseDmIndexEntry } from '../storage/dmIndex';
import { log } from '@/shared/lib/logger';

const wnLog = log.child({ module: 'whitenoise' });

/**
 * Returns the list of counterparty pubkeys we've established a 1:1 White
 * Noise group with on the active account. Surfaces them as "contacts" so
 * the Contacts > Recent / All pills include accepted Marmot DMs alongside
 * NIP-17/NIP-04 contacts.
 *
 * Refreshes when the InviteReader signals an `inviteRead` event (i.e.
 * accept/decline finished), which is when the index could have changed.
 */
export function useWhitenoiseDmContacts(): {
  entries: WhitenoiseDmIndexEntry[];
  refresh: () => Promise<void>;
} {
  const { inviteReader, accountIndex } = useWhitenoise();
  const [entries, setEntries] = useState<WhitenoiseDmIndexEntry[]>([]);
  const index = useMemo(() => new WhitenoiseDmIndex(accountIndex), [accountIndex]);

  const refresh = useCallback(async () => {
    try {
      const list = await index.list();
      setEntries(list);
    } catch (err) {
      wnLog.warn('whitenoise.dm_contacts.list_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [index]);

  useEffect(() => {
    void refresh();
    if (!inviteReader) return;
    const onChange = () => void refresh();
    inviteReader.on('inviteRead', onChange);
    return () => {
      inviteReader.off('inviteRead', onChange);
    };
  }, [inviteReader, refresh]);

  return { entries, refresh };
}
