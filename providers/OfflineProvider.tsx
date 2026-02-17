import React from 'react';

type OfflineProviderProps = {
  children: React.ReactNode;
};

/**
 * Merge-safe placeholder provider. It preserves the provider boundary expected
 * by tab layouts without changing runtime behavior in this branch.
 */
export function OfflineProvider({ children }: OfflineProviderProps) {
  return <>{children}</>;
}
