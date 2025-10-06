import React from 'react';
import { ColorValue } from 'react-native';
import { StyledText, Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { router } from 'expo-router';
import { VStack } from 'components/ui/View';
import { ButtonHandler, ButtonHandlerButton } from 'components/ui/ButtonHandler';

interface OnboardingLayoutProps {
  title?: string;
  highlight?: string;
  description?: string;
  highlightColors?: readonly [ColorValue, ColorValue, ...ColorValue[]];
  nextScreen?: string;
  actions?: ButtonHandlerButton[];
  children?: React.ReactNode;
}

export function OnboardingLayout({
  title,
  highlight,
  description,
  highlightColors,
  nextScreen,
  actions,
  children,
}: OnboardingLayoutProps) {
  const { getPrimaryColor } = useTheme();
  const handleNext = () => router.push(nextScreen || '/(drawer)/(tabs)');
  const handleBack = () => router.back();

  return (
    <VStack
      align="center"
      justify="space-between"
      flex={1}
      className={`bg-primary-950 h-full p-4 ${children ? '' : 'pt-64'}`}>
      {children ? (
        children
      ) : (
        <VStack className="items-start self-stretch">
          {title && (
            <Text
              size={36}
              lexend
              bold
              className="text-primary-0"
              style={{
                lineHeight: 36,
              }}>
              {title}
            </Text>
          )}
          {highlight && highlightColors && (
            <StyledText
              style={{
                fontSize: 48,
                fontFamily: 'LexendBlack',
                lineHeight: 48,
              }}
              custom
              colors={highlightColors}
              size={32}>
              {highlight}
            </StyledText>
          )}
          {description && (
            <Text
              size={16}
              regular
              lexend
              className="text-primary-0"
              style={{
                textAlign: 'left',
                marginVertical: 8,
              }}>
              {description}
            </Text>
          )}
        </VStack>
      )}

      <ButtonHandler
        buttons={
          actions || [
            {
              text: 'Back',
              icon: 'fa6-solid:chevron-left',
              variant: 'secondary',
              onPress: async () => handleBack(),
            },
            {
              text: 'Next',
              icon: 'fa6-solid:chevron-right',
              variant: 'primary',
              onPress: async () => handleNext(),
            },
          ]
        }
      />
    </VStack>
  );
}
