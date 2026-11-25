import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { CtaScreen } from '@/shared/blocks/CtaScreen';
import { isCtaId } from '@/shared/lib/cta/definitions';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
/** One prompt: a page sheet on iPhone, a full-height bottom sheet on Android. */
export default function CtaRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return isCtaId(id) ? (
    <AndroidSheetRoot>
      <Stack.Screen options={{ headerShown: false }} />
      <CtaScreen key={id} id={id} />
    </AndroidSheetRoot>
  ) : (
    <Redirect href="/" />
  );
}
