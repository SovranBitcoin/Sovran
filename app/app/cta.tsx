import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CtaScreen } from '@/shared/blocks/CtaScreen';
import { isCtaId } from '@/shared/lib/cta/definitions';
export default function CtaRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return isCtaId(id) ? (
    <AndroidSheetRoot headerHeight={0}>
      <CtaScreen key={id} id={id} />
    </AndroidSheetRoot>
  ) : (
    <Redirect href="/" />
  );
}
