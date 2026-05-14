import { useCallback, useRef } from 'react';
import { RefreshControl } from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { router } from 'expo-router';

const AI_ROUTE = '/(drawer)/(tabs)/ai' as const;

type Props = Omit<RefreshControlProps, 'onRefresh' | 'refreshing'> & {
  /** Existing refresh callback. Fired alongside AI navigation if provided. */
  onRefresh?: () => void;
  /** Whether the wrapped refresh is in-flight. Defaults to false. */
  refreshing?: boolean;
};

/**
 * Drop-in `RefreshControl` for the top-level tab scroll surfaces (Wallet,
 * Feed, Contacts). Pulling down at the top of the list navigates to the AI
 * tab, and any wrapped `onRefresh` callback still fires so data refresh on
 * those screens keeps working.
 *
 * This replaces an earlier `Gesture.Fling()`-based screen wrapper: the fling
 * lost to each tab's inner scroll view, so the navigation never triggered.
 * Pull-to-refresh is the one vertical gesture that already composes with the
 * scroll view's pan handler on iOS and Android, so we hang the AI trigger
 * off it.
 */
export function PullToAiRefreshControl({ onRefresh, refreshing = false, ...rest }: Props) {
  const { refreshControl } = usePullToAiRefreshControl({ onRefresh, refreshing, ...rest });
  return refreshControl;
}

export function usePullToAiRefreshControl({ onRefresh, refreshing = false, ...rest }: Props = {}) {
  const isDraggingRef = useRef(false);
  const pendingAiNavigationRef = useRef(false);

  const commitPendingAiNavigation = useCallback(() => {
    if (!pendingAiNavigationRef.current) return;
    pendingAiNavigationRef.current = false;
    router.navigate(AI_ROUTE);
  }, []);

  const handleRefresh = useCallback(() => {
    onRefresh?.();
    if (isDraggingRef.current) {
      pendingAiNavigationRef.current = true;
      return;
    }
    router.navigate(AI_ROUTE);
  }, [onRefresh]);

  const handleScrollBeginDrag = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleScrollEndDrag = useCallback(() => {
    isDraggingRef.current = false;
    commitPendingAiNavigation();
  }, [commitPendingAiNavigation]);

  return {
    refreshControl: <RefreshControl {...rest} refreshing={refreshing} onRefresh={handleRefresh} />,
    onScrollBeginDrag: handleScrollBeginDrag,
    onScrollEndDrag: handleScrollEndDrag,
  };
}
