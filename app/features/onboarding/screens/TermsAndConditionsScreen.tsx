import { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { Button as HerouiButton, ControlField, Label } from 'heroui-native';
import { Button } from '@/shared/ui/primitives/Button';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { LegalDocumentScreen } from '@/shared/blocks/LegalDocumentScreen';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { SettingsProfileRecoveryScreen } from '@/features/settings/screens/SettingsProfileRecoveryScreen';

interface TermsAndConditionsScreenProps {
  onClose: () => void;
  settingsError?: boolean;
  onRetry?: () => void;
}

export function TermsAndConditionsScreen({
  onClose,
  settingsError = false,
  onRetry,
}: TermsAndConditionsScreenProps) {
  const previousAcceptance = useSettingsStore((s) => s.legalAcceptance ?? s.termsAccepted);
  const [step, setStep] = useState<'terms' | 'privacy'>('terms');
  const [isChecked, setIsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const backToTerms = () => {
    setPrivacyChecked(false);
    setStep('terms');
  };

  useEffect(() => {
    if (!showRecovery && step === 'terms') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showRecovery) setShowRecovery(false);
      else {
        setPrivacyChecked(false);
        setStep('terms');
      }
      return true;
    });
    return () => subscription.remove();
  }, [showRecovery, step]);

  if (showRecovery) return <SettingsProfileRecoveryScreen onBack={() => setShowRecovery(false)} />;

  const recovery = (
    <HerouiButton
      variant="ghost"
      testID="legal-view-recovery"
      accessibilityLabel="View existing recovery information"
      onPress={() => setShowRecovery(true)}>
      <HerouiButton.Label>View existing recovery information</HerouiButton.Label>
    </HerouiButton>
  );
  if (settingsError) {
    return (
      <Screen name="LegalSettingsError" safeArea>
        <VStack className="gap-5">
          <Text size={24} bold>
            Could not load your settings
          </Text>
          <Text>
            Your saved agreement could not be read. Retry before continuing; this page will not
            replace unreadable settings with defaults.
          </Text>
          <Button
            text="Retry loading settings"
            testID="legal-settings-retry"
            accessibilityLabel="Retry loading settings"
            onPress={() => onRetry?.()}
          />
          {recovery}
        </VStack>
      </Screen>
    );
  }

  return (
    <LegalDocumentScreen
      key={step}
      documentId={step}
      step={`${previousAcceptance ? 'Updated documents · ' : ''}${step === 'terms' ? '1' : '2'} of 2`}
      navigation={
        <VStack className="gap-1">
          {step === 'privacy' && (
            <Button
              variant="secondary"
              text="Back to Terms"
              testID="privacy-back-to-terms"
              accessibilityLabel="Back to Terms"
              onPress={backToTerms}
            />
          )}
          {recovery}
        </VStack>
      }>
      {step === 'terms' ? (
        <VStack className="gap-4">
          <ControlField
            testID="terms-acceptance"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isChecked }}
            accessibilityValue={{ text: isChecked ? '1' : '0' }}
            isSelected={isChecked}
            onSelectedChange={setIsChecked}>
            <View className="flex-1">
              <Label>
                <Label.Text className="text-sm">
                  I have read and agree to the Terms and Conditions and confirm I am at least 18.
                </Label.Text>
              </Label>
            </View>
            <ControlField.Indicator />
          </ControlField>
          <Button
            text="Continue to Privacy"
            disabled={!isChecked}
            testID="terms-continue"
            accessibilityLabel="Continue to Privacy"
            onPress={() => {
              if (isChecked) setStep('privacy');
            }}
          />
        </VStack>
      ) : (
        <VStack className="gap-4">
          <ControlField
            testID="privacy-acknowledgment"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: privacyChecked }}
            accessibilityValue={{ text: privacyChecked ? '1' : '0' }}
            isSelected={privacyChecked}
            onSelectedChange={setPrivacyChecked}>
            <View className="flex-1">
              <Label>
                <Label.Text className="text-sm">
                  I have read and acknowledge the Privacy Policy.
                </Label.Text>
              </Label>
            </View>
            <ControlField.Indicator />
          </ControlField>
          <Button
            text="Confirm and continue"
            disabled={!isChecked || !privacyChecked}
            testID="privacy-confirm"
            accessibilityLabel="Confirm and continue"
            onPress={() => {
              if (isChecked && privacyChecked) onClose();
            }}
          />
        </VStack>
      )}
    </LegalDocumentScreen>
  );
}
