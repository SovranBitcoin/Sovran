/**
 * @fileoverview ButtonHandler Component - Multi-button layout with overflow handling
 *
 * @module components/ui/ButtonHandler
 *
 * @description
 * **Advanced button layout component with intelligent overflow management**
 * - Displays up to 2 buttons directly, with overflow handling for more
 * - Integrates with SheetManager for additional button actions
 * - Supports conditional button visibility
 * - Theme-aware gradient backgrounds
 * - Context-aware styling (tab vs sheet)
 * - Loading state management across all buttons
 *
 * **Features:**
 * - Smart button overflow (2 visible + "More" button)
 * - Sheet integration for additional actions
 * - Conditional button rendering
 * - Gradient background support
 * - Context-aware spacing and styling
 * - Global loading state management
 *
 * **Usage:**
 * ```typescript
 * // Basic button handler
 * <ButtonHandler
 *   buttons={[
 *     { text: 'Save', variant: 'primary', onPress: handleSave },
 *     { text: 'Cancel', variant: 'secondary', onPress: handleCancel }
 *   ]}
 * />
 *
 * // With context and gradient
 * <ButtonHandler
 *   context="sheet"
 *   gradientColor={color}
 *   buttons={[
 *     { text: 'Confirm', variant: 'primary', onPress: handleConfirm },
 *     { text: 'Close', variant: 'secondary', onPress: handleClose },
 *     { text: 'Delete', variant: 'dangerous', onPress: handleDelete }
 *   ]}
 * />
 *
 * // With conditional buttons
 * <ButtonHandler
 *   buttons={[
 *     { text: 'Save', variant: 'primary', onPress: handleSave, condition: hasChanges },
 *     { text: 'Reset', variant: 'secondary', onPress: handleReset, condition: hasChanges }
 *   ]}
 * />
 * ```
 *
 * @see {@link ./Button}
 * @see {@link components/blocks/sheets/buttonHandler}
 * @see {@link ./View}
 */

import React, { useState } from 'react';
import { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { Button } from '@/shared/ui/primitives/Button';
import { buttonHandlerPopup, emojiPickerPopup } from '@/shared/lib/popup';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import Icon from '@/assets/icons';

/**
 * Configuration for individual buttons in ButtonHandler
 *
 * @interface ButtonHandlerButton
 * @description
 * Defines the properties for each button in the ButtonHandler component.
 * Supports conditional rendering, loading states, and async operations.
 */
export interface ButtonHandlerButton {
  /** Test identifier for automated testing */
  testID?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether the button is in loading state */
  loading?: boolean;
  /** Button variant determining visual style */
  variant: 'primary' | 'secondary' | 'dangerous';
  /** Icon name for the button (optional) */
  icon?: string;
  /** Text content for the button */
  text: string;
  /** Press event handler with close function parameter */
  onPress?: (close: (event: GestureResponderEvent) => void) => Promise<void>;
  /** Optional nested action-sheet target for custom sheet navigation */
  pushSheet?: ButtonHandlerPushTarget;
  /** Whether the button should be visible (default: true) */
  condition?: boolean;
}

type ButtonHandlerPushTarget = {
  sheetId: 'emoji-picker';
  payload: { token: string };
};

export type ButtonHandlerActionButton = ButtonHandlerButton;

/**
 * Props for the ButtonHandler component
 *
 * @interface ButtonHandlerProps
 * @description
 * Configuration object for the ButtonHandler component supporting
 * multiple buttons, context-aware styling, and overflow handling.
 */
interface ButtonHandlerProps {
  /** Context for styling adjustments ('tab' or 'sheet') */
  context?: 'tab' | 'sheet';
  /** Array of button configurations */
  buttons: ButtonHandlerActionButton[];
  /** Additional style overrides */
  style?: StyleProp<ViewStyle>;
  /** Custom gradient color (defaults to theme primary color) */
  gradientColor?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * ButtonHandler component with intelligent overflow management
 *
 * @component
 * @param {ButtonHandlerProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Filter visible buttons → render first 2 buttons → handle overflow → apply gradient background
 * **Effects:** Renders button layout with overflow handling and gradient background
 *
 * @example
 * // Basic two-button layout
 * <ButtonHandler
 *   buttons={[
 *     { text: 'Save', variant: 'primary', onPress: handleSave },
 *     { text: 'Cancel', variant: 'secondary', onPress: handleCancel }
 *   ]}
 * />
 *
 * // Sheet context with overflow
 * <ButtonHandler
 *   context="sheet"
 *   buttons={[
 *     { text: 'Confirm', variant: 'primary', onPress: handleConfirm },
 *     { text: 'Close', variant: 'secondary', onPress: handleClose },
 *     { text: 'Delete', variant: 'dangerous', onPress: handleDelete }
 *   ]}
 * />
 */
export function ButtonHandler({
  context: _context,
  buttons,
  style,
  gradientColor,
  className,
}: ButtonHandlerProps) {
  const [loading, setLoading] = useState(false);
  const background = useThemeColor('background');

  // Filter buttons based on condition
  const visibleButtons = buttons.filter((button) => button.condition !== false);

  /**
   * Handles button press with loading state management
   *
   * @description
   * Manages global loading state and executes button press handlers.
   * Prevents multiple simultaneous actions and ensures proper cleanup.
   *
   * **Process:** Check disabled state → set loading → execute handler → clear loading
   * **Effects:** Updates loading state and executes button action
   *
   * @param {ButtonHandlerButton} button - The button that was pressed
   * @returns {Promise<void>} Resolves when button action completes
   *
   * @example
   * handleButtonPress(button) // Executes button.onPress with loading management
   */
  const handleButtonPress = async (button: ButtonHandlerActionButton) => {
    if (button.disabled) return;
    if (button.pushSheet) {
      if (button.pushSheet.sheetId === 'emoji-picker') {
        emojiPickerPopup(button.pushSheet.payload);
      }
      return;
    }

    setLoading(true);
    try {
      await button.onPress?.(() => {});
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles "More" button press for overflow actions
   *
   * @description
   * Manages overflow button behavior. If exactly 3 buttons, executes the third.
   * Otherwise, opens the button-handler sheet with all visible buttons.
   *
   * **Process:** Check button count → execute third button or open sheet
   * **Effects:** Either executes action or opens overflow sheet
   *
   * @returns {Promise<void>} Resolves when action completes
   *
   * @example
   * handleMorePress() // Executes third button or opens sheet
   */
  const handleMorePress = async () => {
    buttonHandlerPopup({ buttons: visibleButtons });
  };

  return (
    <HStack
      align="center"
      justify="space-between"
      spacing={0}
      className={`flex-row pb-6 ${className || ''}`}
      style={[style]}>
      <LinearGradient
        colors={[
          opacity(gradientColor || background, 0.75),
          opacity(gradientColor || background, 0),
        ]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {visibleButtons.slice(0, 2).map((button, index) => (
        <View key={index} className="flex-1">
          <Button
            testID={button.testID}
            onPress={() => handleButtonPress(button)}
            text={button.text}
            variant={button.variant}
            loading={loading || button.loading}
            disabled={button.disabled}
          />
        </View>
      ))}

      {/* More button (if more than 2 buttons) */}
      {visibleButtons.length > 2 && (
        <View>
          <Button
            testID="more-button"
            icon={
              visibleButtons.length === 3 && visibleButtons[2].icon ? (
                <Icon name={visibleButtons[2].icon} />
              ) : (
                <Icon name="tabler:dots" />
              )
            }
            onPress={handleMorePress}
            variant="secondary"
            loading={loading}
            disabled={visibleButtons.length === 3 && visibleButtons[2].disabled}
          />
        </View>
      )}
    </HStack>
  );
}
