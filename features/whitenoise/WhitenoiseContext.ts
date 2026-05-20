import { createContext, useContext } from 'react';
import type { InviteReader, MarmotClient } from '@internet-privacy/marmot-ts';
import type { WhitenoiseGroupHistory } from './storage/groupHistory';

type WhitenoiseClient = MarmotClient<WhitenoiseGroupHistory>;

export type WhitenoiseContextValue = {
  client: WhitenoiseClient | null;
  inviteReader: InviteReader | null;
  relays: readonly string[];
  accountIndex: number;
};

export const WhitenoiseContext = createContext<WhitenoiseContextValue | null>(null);

/**
 * Lives in its own module so `WhitenoiseProvider` and consumers like
 * `useWhitenoiseInbox` can import it without a Provider ↔ hook cycle —
 * the cycle was tolerated by Hermes (hooks read at call time) but defeated
 * tree-shaking and showed up in static analysis.
 */
export function useWhitenoise(): WhitenoiseContextValue {
  const value = useContext(WhitenoiseContext);
  if (!value) {
    throw new Error('useWhitenoise must be used inside WhitenoiseProvider');
  }
  return value;
}
