import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { CtaScreen } from '@/shared/blocks/CtaScreen';
import { isCtaId } from '@/shared/lib/cta/definitions';
export default function CtaRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return isCtaId(id) ? (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CtaScreen key={id} id={id} />
    </>
  ) : (
    <Redirect href="/" />
  );
}
