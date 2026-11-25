import { Stack } from 'expo-router';

import { MerchantDetailScreen } from '@/features/map';

export default function MerchantDetailRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Merchant Details' }} />
      <MerchantDetailScreen />
    </>
  );
}
