import React from 'react';
import { usePaymentsSearch } from './_layout';
import { PaymentsScreen } from '@/features/payments';

const PaymentsRoute = () => {
  const { searchQuery, isSearching } = usePaymentsSearch();
  return <PaymentsScreen searchQuery={searchQuery} isSearching={isSearching} />;
};

export default PaymentsRoute;
