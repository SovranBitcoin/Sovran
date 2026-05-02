/**
 * @fileoverview ButtonHandler Component - Multi-button layout with overflow handling
 *
 * @module shared/ui/composed/ButtonHandler
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
 * @see {@link ./View}
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { Menu, type MenuTriggerRef } from 'heroui-native';
import { Log } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/primitives/Button';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
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
  /** Text content for the button. Accepts a plain string (rendered in
   *  the button's default OxygenBold 14 wrapper) or a ReactNode (rendered
   *  inline — use this to compose primitives like `AmountFormatter`
   *  alongside static text). */
  text: string | React.ReactNode;
  /** Optional secondary caption shown under the button text in the overflow
   *  Menu (has no effect on inline buttons). */
  description?: string;
  /** Press event handler with close function parameter */
  onPress?: (close: (event: GestureResponderEvent) => void) => Promise<void>;
  /** Whether the button should be visible (default: true) */
  condition?: boolean;
}

export type ButtonHandlerActionButton = ButtonHandlerButton;

/**
 * Props for the ButtonHandler component
 *
 * @interface ButtonHandlerProps
 * @description
 * Configuration object for the ButtonHandler component supporting
 * multiple buttons, context-aware styling, and overflow handling.
 */
export interface ButtonHandlerProps {
  /** Context for styling adjustments ('tab' or 'sheet') */
  context?: 'tab' | 'sheet';
  /** Array of button configurations */
  buttons: ButtonHandlerActionButton[];
  /** Additional style overrides */
  style?: StyleProp<ViewStyle>;
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
  className,
}: ButtonHandlerProps) {
  const [loading, setLoading] = useState(false);
  const danger = useThemeColor('danger');

  // Filter buttons based on condition
  const visibleButtons = buttons.filter((button) => button.condition !== false);

  // Overflow Menu contents — items 3+ only. The first two are already
  // rendered inline so we'd double-list them otherwise. Preserve the
  // "Next last" reorder so a flow-continuation button (if any) anchors the
  // bottom of the sheet.
  const overflowMenuButtons = useMemo(() => {
    const overflow = visibleButtons.slice(2);
    return [
      ...overflow.filter((b) => b.text !== 'Next'),
      ...overflow.filter((b) => b.text === 'Next'),
    ];
  }, [visibleButtons]);

  // heroui's `Menu.Trigger asChild` routes through `Slot.Pressable`, which
  // doesn't compose with our Button (it wraps `TouchableOpacity`, not
  // `Pressable`). Use the same imperative-open pattern as the Copy menu:
  // invisible ref-backed Trigger + `.open()` from the visible button's
  // onPress.
  const moreMenuTriggerRef = useRef<MenuTriggerRef>(null);
  const openMoreMenu = useCallback(() => {
    setTimeout(() => moreMenuTriggerRef.current?.open(), 0);
  }, []);

  // Fires the button's onPress with a no-op close since the Menu closes
  // itself on select (shouldCloseOnSelect default). Any async work runs in
  // the background — callers still get their own per-button `loading` state.
  const handleMenuItemPress = (button: ButtonHandlerActionButton): void => {
    if (button.disabled) return;
    void button.onPress?.(() => {});
  };

  // The inner shared `Button` already routes its onPress through
  // `useSingleFlight`, so a rapid second tap is dropped before reaching
  // this wrapper. We only own the spinner-coordination boolean here.
  const handleButtonPress = async (button: ButtonHandlerActionButton) => {
    if (button.disabled) return;
    const result = button.onPress?.(() => {});
    if (!(result instanceof Promise)) return;
    setLoading(true);
    try {
      await result;
    } finally {
      setLoading(false);
    }
  };

  return (
    <Log name="ButtonHandler">
      <HStack
        align="center"
        justify="space-between"
        spacing={0}
        className={`flex-row ${className || ''}`}
        style={[style]}>
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

        {/* Exactly 3 buttons: render the third inline as an icon-only button. */}
        {visibleButtons.length === 3 && (
          <View>
            <Button
              testID={visibleButtons[2].testID ?? 'more-button'}
              icon={
                visibleButtons[2].icon ? (
                  <Icon name={visibleButtons[2].icon} />
                ) : (
                  <Icon name="tabler:dots" />
                )
              }
              onPress={() => handleButtonPress(visibleButtons[2])}
              variant="secondary"
              loading={loading}
              disabled={visibleButtons[2].disabled}
            />
          </View>
        )}

        {/* 4+ buttons: "More" opens a bottom-sheet Menu listing items 3+. */}
        {visibleButtons.length > 3 && (
          <>
            <Menu presentation="bottom-sheet">
              <Menu.Trigger
                ref={moreMenuTriggerRef}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
                <View style={{ width: 1, height: 1 }} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="bottom-sheet">
                  <Menu.Label className="text-lg font-bold text-foreground ml-3 -mt-2 mb-2">
                    Select option
                  </Menu.Label>
                  {overflowMenuButtons.map((button, i) => {
                    const label = typeof button.text === 'string' ? button.text : 'Action';
                    const isDanger = button.variant === 'dangerous';
                    return (
                      <Menu.Item
                        key={i}
                        testID={button.testID ? `overflow-${button.testID}` : undefined}
                        isDisabled={button.disabled}
                        variant={isDanger ? 'danger' : 'default'}
                        onPress={() => handleMenuItemPress(button)}>
                        <HStack align="center" gap={10} style={{ flex: 1 }}>
                          {button.icon ? (
                            <Icon
                              name={button.icon}
                              size={20}
                              color={isDanger ? danger : undefined}
                            />
                          ) : null}
                          <View style={{ flex: 1 }}>
                            <Menu.ItemTitle>{label}</Menu.ItemTitle>
                            {button.description ? (
                              <Menu.ItemDescription>{button.description}</Menu.ItemDescription>
                            ) : null}
                          </View>
                        </HStack>
                      </Menu.Item>
                    );
                  })}
                </Menu.Content>
              </Menu.Portal>
            </Menu>
            <View>
              <Button
                testID="more-button"
                icon={<Icon name="tabler:dots" />}
                onPress={openMoreMenu}
                variant="secondary"
                loading={loading}
              />
            </View>
          </>
        )}
      </HStack>
    </Log>
  );
}
