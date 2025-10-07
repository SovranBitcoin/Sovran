import React, { useState, useCallback, useMemo } from 'react';
import { Pressable } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { AnimatedQRCode } from 'components/ui/QRCode';
import { Spacer, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { GradientSkeleton } from 'components/ui/GradientSkeleton';
import { useTheme } from 'providers/ThemeProvider';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Animated from 'react-native-reanimated';
import { popup } from '@/helper/popup';
import { Section } from 'components/ui/Section';

interface TabItem {
  name: string;
  value: string;
}

interface PaymentInfoProps {
  unit: string;
  data: string | TabItem[];
  link?: string;
  popupMessage: string | { [key: number]: { name: string } };
  setUri?: (uri: string) => void;
  animated?: boolean;
  variant?: 'primary' | 'secondary';
  showSection?: boolean;
}

export function PaymentInfo({
  unit,
  data,
  link,
  popupMessage,
  setUri,
  animated = false,
  variant = 'primary',
  showSection = true,
}: PaymentInfoProps): React.ReactElement {
  const { getPrimaryColor } = useTheme();

  const [activeTab, setActiveTab] = useState<number>(0);

  const hasTabs = Array.isArray(data) && data.length > 0;
  const TABS = useMemo(() => (hasTabs ? data.map((item) => item.name) : []), [hasTabs, data]);

  const [selectedValue, setSelectedValue] = useState<string>(
    hasTabs ? data[0].value : typeof data === 'string' ? data : ''
  );

  const handleCopyPress = useCallback(async () => {
    const textToCopy = link || selectedValue;
    await Clipboard.setStringAsync(textToCopy);

    const message =
      typeof popupMessage === 'string'
        ? popupMessage
        : (popupMessage[activeTab]?.name ?? 'Copied to clipboard');

    popup({ message, type: 'success' });
  }, [link, selectedValue, popupMessage, activeTab]);

  const renderQRCode = (): React.ReactElement => {
    if (!selectedValue) {
      return (
        <HStack align="center" justify="center">
          <GradientSkeleton startColor={getPrimaryColor('800')} endColor={getPrimaryColor('950')} />
        </HStack>
      );
    }

    return (
      <Pressable onPress={handleCopyPress}>
        <ViewShot captureMode="mount" onCapture={setUri}>
          <AnimatedQRCode
            padding={32}
            unit={unit}
            address={selectedValue}
            animate={animated}
            variant={variant}
          />
        </ViewShot>
      </Pressable>
    );
  };

  const renderSection = (): React.ReactElement | null => {
    if (!selectedValue || !showSection) return null;

    return (
      <>
        <Spacer size={12} />
        <Section
          special={true}
          style={{
            marginHorizontal: 16,
            marginBottom: 0,
          }}
          items={[
            {
              title: '',
              value: link || selectedValue,
            },
          ]}
        />
      </>
    );
  };

  return (
    <>
      {renderQRCode()}
      {renderSection()}
    </>
  );
}

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  onLayout: (event: any) => void;
  isFirst: boolean;
  animatedStyle: any;
}

const TabButton = React.memo(
  ({
    label,
    isActive,
    onPress,
    onLayout,
    isFirst,
    animatedStyle,
  }: TabButtonProps): React.ReactElement => {
    const { getShadeColor, getPrimaryColor } = useTheme();

    return (
      <TouchableOpacity
        onPress={onPress}
        className="relative flex-1 items-center pb-2"
        onLayout={onLayout}>
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: isActive ? getPrimaryColor('0') : getPrimaryColor('400'),
          }}>
          {label}
        </Text>
        {isFirst && (
          <Animated.View
            style={[
              {
                height: 2,
                width: '100%',
                backgroundColor: getShadeColor('300'),
                position: 'absolute',
                bottom: 0,
                top: 8,
              },
              animatedStyle,
            ]}
          />
        )}
      </TouchableOpacity>
    );
  }
);

TabButton.displayName = 'TabButton';
