/**
 * @fileoverview Context Menu Component - iOS-style Quick Actions menu
 *
 * @module components/ui/ContextMenu
 *
 * @description
 * iOS-style context menu component that mimics Quick Actions appearance.
 * Features translucent blur background, rounded corners, and vertical option list.
 *
 * **Usage:**
 * ```typescript
 * <ContextMenu
 *   visible={isVisible}
 *   options={[
 *     { label: 'Option 1', value: 1 },
 *     { label: 'Option 2', value: 2 }
 *   ]}
 *   selectedValue={currentValue}
 *   onSelect={(value) => setCurrentValue(value)}
 *   onDismiss={() => setIsVisible(false)}
 * />
 * ```
 */

import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Text } from './Text';
import { View } from './View';
import { useTheme } from 'providers/ThemeProvider';
import Icon from '@/assets/icons';
import opacity from 'hex-color-opacity';

export interface ContextMenuOption {
  label: string;
  value: number | string;
}

interface ContextMenuProps {
  visible: boolean;
  options: ContextMenuOption[];
  selectedValue?: number | string;
  onSelect: (value: number | string) => void;
  onDismiss: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  options,
  selectedValue,
  onSelect,
  onDismiss,
}) => {
  const { getPrimaryColor, currentTheme } = useTheme();
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.95)).current;

  const isLightTheme = currentTheme === 'light' || currentTheme === 'beige';
  const blurTint = isLightTheme ? 'light' : 'dark';
  const blurIntensity = isLightTheme ? 7.5 : 75;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          damping: 20,
          stiffness: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.95,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, scaleAnim]);

  const handleSelect = (value: number | string) => {
    onSelect(value);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Animated.View
          style={[
            styles.container,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}>
          <BlurView
            tint={blurTint}
            intensity={blurIntensity}
            experimentalBlurMethod="dimezisBlurView"
            style={[
              styles.menu,
              {
                backgroundColor: opacity(
                  isLightTheme ? getPrimaryColor('0') : getPrimaryColor('800'),
                  isLightTheme ? 0.9 : 0.8
                ),
              },
            ]}>
            {options.map((option, index) => {
              const isSelected = selectedValue === option.value;
              const isLast = index === options.length - 1;

              return (
                <React.Fragment key={option.value}>
                  <Pressable
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    onPress={() => handleSelect(option.value)}>
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: isSelected
                            ? getPrimaryColor('0')
                            : isLightTheme
                              ? getPrimaryColor('950')
                              : getPrimaryColor('0'),
                        },
                      ]}
                      size={16}
                      medium>
                      {option.label}
                    </Text>
                    {isSelected && (
                      <Icon
                        name="material-symbols:check"
                        size={20}
                        color={isLightTheme ? getPrimaryColor('950') : getPrimaryColor('0')}
                      />
                    )}
                  </Pressable>
                  {!isLast && (
                    <View
                      style={[
                        styles.divider,
                        {
                          backgroundColor: opacity(
                            isLightTheme ? getPrimaryColor('950') : getPrimaryColor('0'),
                            0.1
                          ),
                        },
                      ]}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </BlurView>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    borderRadius: 14,
    paddingVertical: 8,
    minWidth: 200,
    maxWidth: 300,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionText: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
});

