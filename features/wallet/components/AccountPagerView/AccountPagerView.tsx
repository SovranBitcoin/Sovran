import React from 'react';

import { AccountPagerViewLayout } from './AccountPagerViewLayout';
import { useAccountPagerView, type AccountPagerViewProps } from './useAccountPagerView';
import { Log } from '@/shared/lib/logger';

export function AccountPagerView(props: AccountPagerViewProps): React.ReactElement {
  const shared = useAccountPagerView(props);
  return (
    <Log name="AccountPagerView">
      <AccountPagerViewLayout shared={shared} />
    </Log>
  );
}
