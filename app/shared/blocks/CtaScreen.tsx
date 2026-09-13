import { useColadaBalance } from 'wallet/react';
import { SheetGrabber } from '@/shared/ui/composed/SheetGrabber';
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
import { ControlField, Label } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import type { CtaId } from '@/shared/lib/cta/types';
import { useCtaStore } from '@/shared/stores/global/ctaStore';

/** Modal dismissal must finish before the backup flow is presented, or the
 * native stack mounts the flow underneath the still-presented prompt. */
export const BACKUP_HANDOFF_MS = 450;
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { openExternalUrl } from '@/shared/lib/url';
import { DOWNLOAD_URL } from '@/shared/config/download';

export function CtaScreen({ id }: { id: CtaId }) {
  const cta = CTA_DEFINITIONS.find((definition) => definition.id === id)!;
  const balance = useColadaBalance('sat');
  const navigation = useNavigation();
  const foreground = useThemeColor('foreground');
  const previewOverride = useCtaStore((s) => s.previewOverride);
  const preview = previewOverride === id;
  const closing = useCtaStore((s) => s.closingId === id);
  const latestVersion = useSettingsStore((s) => s.lastKnownAppVersion?.version);
  const triggerVersion = id === 'update-required' ? latestVersion : undefined;
  const permanentlyDismissed = useCtaStore((s) => !!s.dismissed[id]);
  const [exitingPreview, setExitingPreview] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const dismissalHandled = useRef(false);
  const removalRequested = useRef(false);
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
    if ((!exitingPreview && !closing) || removalRequested.current) return;
    removalRequested.current = true;
    // Release usePreventRemove before dispatching the automatic navigation.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [exitingPreview, closing]);
  useEffect(() => {
    if (cta.presentation === 'blocking-modal') return;
    return navigation.addListener('beforeRemove', () => {
      removalRequested.current = true;
      // Swipe and Android back honor the same checkbox as Not now.
      if (!dismissalHandled.current) {
        dismissalHandled.current = true;
        if (!closing && !preview) useCtaStore.getState().dismiss(id, dontAsk, triggerVersion);
      }
    });
  }, [cta.presentation, navigation, id, dontAsk, triggerVersion, closing, preview]);
  const dismiss = () => {
    if (dismissalHandled.current) return;
    dismissalHandled.current = true;
    removalRequested.current = true;
    if (!preview) useCtaStore.getState().dismiss(id, dontAsk, triggerVersion);
    router.back();
  };
  const primary = async () => {
    if (cta.content.primary.action === 'update') {
      const result = await openExternalUrl(DOWNLOAD_URL);
      setUpdateError(result.isErr());
      return;
    }
    dismissalHandled.current = true;
    removalRequested.current = true;
    const store = useCtaStore.getState();
    store.startBackup();
    store.setActive(null);
    // Dismiss the prompt, then present the flow once the sheet is gone: replacing
    // the presented modal mounted the flow beneath it, and a deferred push from
    // CtaHost never fired on device.
    router.back();
    setTimeout(() => router.raw.push('/(backup-flow)/intro'), BACKUP_HANDOFF_MS);
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
          {!blocking && cta.content.secondary && (
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
        {!blocking && <SheetGrabber />}
        {!blocking && (
          <View className="items-end px-4 pt-2">
            <Pressable
              testID="cta-close"
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={dismiss}
              className="bg-surface-secondary h-11 w-11 items-center justify-center rounded-full">
              <Icon name="mdi:close" size={24} color={foreground} />
            </Pressable>
          </View>
        )}
        <View testID="cta-screen" className="gap-6 px-6 py-6">
          <View className="bg-surface-secondary h-24 w-24 items-center justify-center self-center rounded-full">
            <Icon name={cta.content.icon} size={48} color={foreground} />
          </View>
          <Text size={28} bold className="text-center">
            {cta.content.title}
          </Text>
          <Text size={16} className="text-foreground/70 text-center">
            {typeof cta.content.body === 'function'
              ? cta.content.body(balance.total)
              : cta.content.body}
          </Text>
          {updateError && (
            <Text accessibilityRole="alert" className="text-center">
              Could not open the download page. Try again.
            </Text>
          )}
          {cta.dismissPolicy === 'do-not-ask-again' && (
            <ControlField
              testID="cta-dont-ask"
              accessibilityRole="checkbox"
              accessibilityLabel="Do not ask me again"
              accessibilityState={{ checked: dontAsk }}
              accessibilityValue={{ text: dontAsk ? '1' : '0' }}
              isSelected={dontAsk}
              onSelectedChange={setDontAsk}>
              <View className="flex-1">
                <Label>
                  <Label.Text className="text-sm">Do not ask me again</Label.Text>
                </Label>
              </View>
              <ControlField.Indicator />
            </ControlField>
          )}
        </View>
      </ScreenScrollView>
      {preview && (
        <E2EAccessibilityProbe
          testID={permanentlyDismissed ? 'cta-dismissed-yes' : 'cta-dismissed-no'}
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
