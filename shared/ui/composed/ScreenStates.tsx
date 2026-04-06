import React from 'react';
import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface ScreenErrorStateProps {
  message: string;
  /** Optional title displayed above the message (e.g. "Error") */
  title?: string;
  onGoBack: () => void;
}

export function ScreenErrorState({ message, title, onGoBack }: ScreenErrorStateProps) {
  const foreground = useThemeColor('foreground');

  return (
    <Log name="ScreenErrorState">
    <ModalLayoutWrapper>
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        {title ? (
          <>
            <Text
              size={18}
              bold
              style={{
                color: opacity(foreground, 0.9),
                marginBottom: 16,
                textAlign: 'center',
              }}>
              {title}
            </Text>
            <Text
              size={14}
              style={{
                color: opacity(foreground, 0.5),
                marginBottom: 24,
                textAlign: 'center',
              }}>
              {message}
            </Text>
          </>
        ) : (
          <Text color={opacity(foreground, 0.66)}>{message}</Text>
        )}
        <ButtonHandler
          buttons={[
            {
              text: 'Go Back',
              icon: 'ri:arrow-left-line',
              variant: 'primary',
              onPress: async () => onGoBack(),
            },
          ]}
        />
      </View>
    </ModalLayoutWrapper>
    </Log>
  );
}

interface ScreenLoadingStateProps {
  message: string;
}

export function ScreenLoadingState({ message }: ScreenLoadingStateProps) {
  const foreground = useThemeColor('foreground');

  return (
    <Log name="ScreenLoadingState">
    <ModalLayoutWrapper>
      <VStack style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Spinner size={32} />
        <Text size={16} style={{ color: opacity(foreground, 0.5), marginTop: 16 }}>
          {message}
        </Text>
      </VStack>
    </ModalLayoutWrapper>
    </Log>
  );
}
