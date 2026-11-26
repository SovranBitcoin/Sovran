import { createContext, useContext, type ReactNode } from 'react';

import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

type SearchClose = {
  /** Leaves Search for the tab it was opened from. */
  close: () => void;
  /** VoiceOver/TalkBack label naming where closing returns to. */
  accessibilityLabel: string;
};

// Without a tab navigator above it (tests, a stray mount), close goes to Wallet.
const WALLET_CLOSE: SearchClose = {
  close: () => guardedRouter.raw.navigate('/(drawer)/(tabs)/index'),
  accessibilityLabel: 'Close search. Returns to Wallet',
};

const SearchCloseContext = createContext<SearchClose>(WALLET_CLOSE);

/** The tab navigator tells the Search header where its close button returns to. */
export function SearchCloseProvider({
  value,
  children,
}: {
  value: SearchClose;
  children: ReactNode;
}) {
  return <SearchCloseContext.Provider value={value}>{children}</SearchCloseContext.Provider>;
}

export const useSearchClose = () => useContext(SearchCloseContext);
