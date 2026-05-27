import React from 'react';

import { createPaymentCopyResolver, type PaymentCopyResolver } from 'colada';

export function usePaymentCopyResolver(): PaymentCopyResolver {
  return React.useMemo(() => createPaymentCopyResolver(), []);
}
