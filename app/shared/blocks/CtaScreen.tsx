import { useColadaBalance } from 'wallet/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { ControlField, Label } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import type { CtaBodyView, CtaDefinition, CtaId } from '@/shared/lib/cta/types';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { legacyClaimPrompt, useLegacyEcashStore } from '@/shared/stores/global/legacyEcashStore';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { describeLegacyClaim } from '@/shared/lib/cta/oldEcashPrompt';
import { buildMintInfoHref } from '@/shared/lib/nav/mintInfoRoutes';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { openExternalUrl } from '@/shared/lib/url';
import { DOWNLOAD_URL } from '@/shared/config/download';

export function CtaScreen({ id }: { id: CtaId }) {
  const cta = CTA_DEFINITIONS.find((definition) => definition.id === id)!;
  const balance = useColadaBalance('sat');
  const navigation = useNavigation();
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
  const accountIndex = useProfileStore((s) => s.activeAccountIndex);
  const legacyGroups = useLegacyEcashStore((s) => s.groups);
  const claim = id === 'claim-old-ecash' ? legacyClaimPrompt(legacyGroups, accountIndex) : null;
  const claimMintName = useCachedMintMetadata(claim?.mintUrl)?.displayName;
  const claimSettled = id === 'claim-old-ecash' && !preview && claim === null;
  const blocking = cta.presentation === 'blocking-modal' && !exitingPreview && !closing;
  usePreventRemove(blocking, () => {});
  useEffect(() => {
    // The flow stack's header owns the close action (the same one every modal
    // page shows); a blocking prompt takes it away along with the gesture.
    navigation.setOptions({
      gestureEnabled: !blocking,
      ...(blocking ? { headerLeft: () => null } : {}),
    });
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
  useEffect(() => {
    if (!claimSettled) return;
    // The mint was trusted from the page this prompt opened, so there is
    // nothing left to ask. Wait until this page is the one on top: going back
    // earlier would close the mint page instead.
    const close = () => {
      if (removalRequested.current) return;
      dismissalHandled.current = true;
      removalRequested.current = true;
      router.back();
    };
    if (navigation.isFocused()) return close();
    return navigation.addListener('focus', close);
  }, [claimSettled, navigation]);
  const decline = () => {
    if (dismissalHandled.current) return;
    dismissalHandled.current = true;
    removalRequested.current = true;
    if (claim && !preview)
      useLegacyEcashStore.getState().leaveUnclaimed(claim.mintUrl, accountIndex);
    router.back();
  };
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
    if (cta.content.primary.action === 'trust-mint') {
      // The mint's own page is where a mint is added and trusted. This prompt
      // stays underneath and closes itself once the mint is trusted.
      if (claim) router.push(buildMintInfoHref(claim.mintUrl, { displayName: claimMintName }));
      return;
    }
    // Starting the backup is never a dismissal; the intro is the next page of
    // this same prompt flow, so it simply pushes.
    dismissalHandled.current = true;
    useCtaStore.getState().startBackup();
    router.push('/(prompt-flow)/backup-intro');
  };
  return (
    <CtaView
      cta={cta}
      blocking={blocking}
      body={{
        balanceTotalSat: balance.total,
        oldEcash: claim && describeLegacyClaim(claim, claimMintName),
      }}
      updateError={updateError}
      dontAsk={dontAsk}
      onDontAskChange={setDontAsk}
      onPrimary={primary}
      onDismiss={dismiss}
      onDecline={decline}
      footerEnd={
        preview && (
          <>
            <Button
              testID="cta-preview-back"
              variant="underline"
              text="Back"
              onPress={() => router.back()}
            />
            <Button
              testID="cta-preview-close"
              variant="underline"
              text="End preview"
              onPress={() => {
                if (blocking) setExitingPreview(true);
                else router.back();
              }}
            />
          </>
        )
      }>
      {preview && (
        <E2EAccessibilityProbe
          testID={permanentlyDismissed ? 'cta-dismissed-yes' : 'cta-dismissed-no'}
          accessibilityLabel="Reminder dismissed permanently"
          value={permanentlyDismissed ? '1' : '0'}
        />
      )}
      {claim && (
        <E2EAccessibilityProbe
          testID="cta-claim-mint"
          accessibilityLabel="Mint holding old ecash"
          value={claim.mintUrl}
        />
      )}
      <E2EAccessibilityProbe
        testID="cta-active"
        accessibilityLabel="Active call to action"
        value={id}
      />
    </CtaView>
  );
}

/**
 * The prompt as drawn, from props alone: it reads no store and navigates
 * nowhere. `CtaScreen` supplies live state and the real actions; the design
 * system supplies sample data and handlers that change nothing.
 */
export function CtaView({
  cta,
  blocking,
  body,
  updateError,
  dontAsk,
  onDontAskChange,
  onPrimary,
  onDismiss,
  onDecline,
  footerEnd,
  children,
}: {
  cta: CtaDefinition;
  /** A blocking prompt draws no way out. */
  blocking: boolean;
  body: CtaBodyView;
  updateError: boolean;
  dontAsk: boolean;
  onDontAskChange: (value: boolean) => void;
  onPrimary: () => void;
  onDismiss: () => void;
  onDecline: () => void;
  /** Buttons after the prompt's own. */
  footerEnd?: ReactNode;
  /** Probes with no visible node. */
  children?: ReactNode;
}) {
  const foreground = useThemeColor('foreground');
  return (
    <Screen
      name="CtaScreen"
      scroll="custom"
      safeArea
      deferContent={false}
      footer={
        <BottomButtons>
          <Button testID="cta-primary" text={cta.content.primary.label} onPress={onPrimary} />
          {!blocking && cta.content.secondary && (
            <Button
              testID="cta-secondary"
              variant="secondary"
              text={cta.content.secondary.label}
              onPress={onDismiss}
            />
          )}
          {!blocking && cta.content.decline && (
            <Button
              testID="cta-decline"
              variant="underline"
              text={cta.content.decline.label}
              onPress={onDecline}
            />
          )}
          {footerEnd}
        </BottomButtons>
      }>
      <ScreenScrollView>
        <View testID="cta-screen" className="gap-6 px-6 py-6">
          <View className="bg-surface-secondary h-24 w-24 items-center justify-center self-center rounded-full">
            <Icon name={cta.content.icon} size={48} color={foreground} />
          </View>
          <Text size={28} bold className="text-center">
            {cta.content.title}
          </Text>
          <Text size={16} className="text-foreground/70 text-center">
            {typeof cta.content.body === 'function' ? cta.content.body(body) : cta.content.body}
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
              onSelectedChange={onDontAskChange}>
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
      {children}
    </Screen>
  );
}
