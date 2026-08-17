import { RefreshControl } from 'react-native';
import type { RefreshControlProps } from 'react-native';

type Props = Omit<RefreshControlProps, 'onRefresh' | 'refreshing'> & {
  /** Existing refresh callback. Fired on pull-to-refresh. */
  onRefresh?: () => void;
  /** Whether the wrapped refresh is in-flight. Defaults to false. */
  refreshing?: boolean;
};

export function usePullToAiRefreshControl({ onRefresh, refreshing = false, ...rest }: Props = {}) {
  return {
    refreshControl: <RefreshControl {...rest} refreshing={refreshing} onRefresh={onRefresh} />,
  };
}
