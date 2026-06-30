import React from 'react';

import { createPaymentCopyResolver, type PaymentCopyResolver } from '@sovranbitcoin/colada';

import { cashuLog } from '@/shared/lib/logger';

export function usePaymentCopyResolver(): PaymentCopyResolver {
  return React.useMemo(() => {
    cashuLog.debug('payment.copy_resolver.create', { source: 'usePaymentCopyResolver' });
    return createPaymentCopyResolver();
  }, []);
}
