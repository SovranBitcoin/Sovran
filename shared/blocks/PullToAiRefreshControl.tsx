import { RefreshControl } from 'react-native';
import type { RefreshControlProps } from 'react-native';

type Props = Omit<RefreshControlProps, 'onRefresh' | 'refreshing'> & {
  /** Existing refresh callback. Fired on pull-to-refresh. */
  onRefresh?: () => void;
  /** Whether the wrapped refresh is in-flight. Defaults to false. */
  refreshing?: boolean;
};

/**
 * Drop-in `RefreshControl` for the top-level tab scroll surfaces (Wallet,
 * Feed, Contacts). Pulling down at the top of the list fires any wrapped
 * `onRefresh`. The previous AI-tab navigation behaviour has been removed —
 * the gesture is now a plain refresh.
 */
export function usePullToAiRefreshControl({ onRefresh, refreshing = false, ...rest }: Props = {}) {
  return {
    refreshControl: <RefreshControl {...rest} refreshing={refreshing} onRefresh={onRefresh} />,
  };
}
