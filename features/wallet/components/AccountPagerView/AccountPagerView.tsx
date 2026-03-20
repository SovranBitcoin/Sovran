import React from 'react';

import { AccountPagerViewLayout } from './AccountPagerViewLayout';
import { useAccountPagerView, type AccountPagerViewProps } from './useAccountPagerView';

export function AccountPagerView(props: AccountPagerViewProps): React.ReactElement {
  const shared = useAccountPagerView(props);
  return <AccountPagerViewLayout shared={shared} />;
}
