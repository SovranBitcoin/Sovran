import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { useNavigation } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { usePreventRemove } from 'expo-router/react-navigation';
import Icon from '@/assets/icons';
import { Screen } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { Button } from '@/shared/ui/primitives/Button';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import type { CtaId } from '@/shared/lib/cta/types';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { openExternalUrl } from '@/shared/lib/url';
import { DOWNLOAD_URL } from '@/shared/config/download';

export function CtaScreen({ id }: { id: CtaId }) {
  const cta = CTA_DEFINITIONS.find((definition) => definition.id === id)!;
  const navigation = useNavigation();
  const foreground = useThemeColor('foreground');
  const previewOverride = useCtaStore((s) => s.previewOverride);
  const preview = previewOverride === id;
  const closing = useCtaStore((s) => s.closingId === id);
  const permanentlyDismissed = useCtaStore((s) => !!s.dismissed[id]);
  const [exitingPreview, setExitingPreview] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const dismissalHandled = useRef(false);
  const [updateError, setUpdateError] = useState(false);
  const blocking = cta.presentation === 'blocking-modal' && !exitingPreview && !closing;
  usePreventRemove(blocking, () => {});
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !blocking });
    if (!blocking) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [blocking, navigation]);
  useEffect(() => {
    if (!exitingPreview && !closing) return;
    // Release usePreventRemove before dispatching the automatic navigation.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [exitingPreview, closing]);
  useEffect(() => {
    if (cta.presentation === 'blocking-modal') return;
    return navigation.addListener('beforeRemove', () => {
      // Swipe and Android back honor the same checkbox as Not now.
      if (!dismissalHandled.current) useCtaStore.getState().dismiss(id, dontAsk);
    });
  }, [cta.presentation, navigation, id, dontAsk]);
  const dismiss = () => {
    dismissalHandled.current = true;
    useCtaStore.getState().dismiss(id, dontAsk);
    router.back();
  };
  const primary = async () => {
    if (cta.content.primary.action === 'update') {
      const result = await openExternalUrl(DOWNLOAD_URL);
      setUpdateError(result.isErr());
      return;
    }
    dismissalHandled.current = true;
    useCtaStore.getState().startBackup();
    router.replace('/(settings-flow)/profile');
  };
  return (
    <Screen
      name="CtaScreen"
      scroll="custom"
      safeArea
      deferContent={false}
      footer={
        <BottomButtons>
          <Button testID="cta-primary" text={cta.content.primary.label} onPress={primary} />
          {cta.content.secondary && (
            <Button
              testID="cta-secondary"
              variant="secondary"
              text={cta.content.secondary.label}
              onPress={dismiss}
            />
          )}
          {preview && (
            <Button
              testID="cta-preview-back"
              variant="underline"
              text="Back"
              onPress={() => router.back()}
            />
          )}
          {preview && (
            <Button
              testID="cta-preview-close"
              variant="underline"
              text="End preview"
              onPress={() => {
                if (blocking) setExitingPreview(true);
                else router.back();
              }}
            />
          )}
        </BottomButtons>
      }>
      <ScreenScrollView>
        <View testID="cta-screen" className="gap-6 px-6 py-12">
          <View className="bg-surface-secondary h-24 w-24 items-center justify-center self-center rounded-full">
            <Icon name={cta.content.icon} size={48} color={foreground} />
          </View>
          <Text size={28} bold className="text-center">
            {cta.content.title}
          </Text>
          <Text size={16} className="text-foreground/70 text-center">
            {cta.content.body}
          </Text>
          {updateError && (
            <Text accessibilityRole="alert" className="text-center">
              Could not open the download page. Try again.
            </Text>
          )}
          {cta.dismissPolicy === 'do-not-ask-again' && (
            <Pressable
              testID="cta-dont-ask"
              accessibilityRole="checkbox"
              accessibilityLabel="Do not ask me again"
              accessibilityState={{ checked: dontAsk }}
              onPress={() => setDontAsk(!dontAsk)}
              className="min-h-12 flex-row items-center justify-center gap-3">
              <SelectableCheck selected={dontAsk} />
              <Text>Do not ask me again</Text>
            </Pressable>
          )}
        </View>
      </ScreenScrollView>
      {preview && (
        <E2EAccessibilityProbe
          testID="cta-dismissed"
          accessibilityLabel="Reminder dismissed permanently"
          value={permanentlyDismissed ? '1' : '0'}
        />
      )}
      <E2EAccessibilityProbe
        testID="cta-active"
        accessibilityLabel="Active call to action"
        value={id}
      />
    </Screen>
  );
}
