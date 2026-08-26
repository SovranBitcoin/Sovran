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

import React, { useMemo, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Log, log } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/primitives/Button';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from '@/assets/icons';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';

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
  /** Press event handler. ButtonHandler renders inline buttons (and an
   *  overflow Menu); neither host owns a dismissal seam to forward, so the
   *  handler takes no arguments. Callers that need to dismiss a parent
   *  surface should do it explicitly inside the body. */
  onPress?: () => void | Promise<void>;
  /** Whether the button should be visible (default: true) */
  condition?: boolean;
}

type ButtonHandlerActionButton = ButtonHandlerButton;

// Keep async action failures contained so overflow actions do not surface as
// unhandled promise rejections on Android.
async function runMenuItemAction(button: ButtonHandlerActionButton): Promise<void> {
  if (button.disabled) return;
  try {
    await button.onPress?.();
  } catch (error) {
    log.error('ui.button_handler.menu_action_failed', {
      testID: button.testID,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// The inner shared `Button` already routes its onPress through
// `useSingleFlight`, so a rapid second tap is dropped before reaching
// this wrapper. We track the in-flight button by its visible-array index
// so siblings keep their own visual state while one action runs.
async function runButtonAction(
  button: ButtonHandlerActionButton,
  idx: number,
  setLoadingIdx: React.Dispatch<React.SetStateAction<number | null>>
): Promise<void> {
  if (button.disabled) return;
  setLoadingIdx(idx);
  try {
    await button.onPress?.();
  } catch (error) {
    log.error('ui.button_handler.action_failed', {
      testID: button.testID,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    setLoadingIdx((current) => (current === idx ? null : current));
  }
}

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
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);

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

  // The overflow sheet is the FullWindowOverlay-backed `actionMenuSheet()`
  // lane (PopupHost's standalone <BottomSheet>). ButtonHandler footers live
  // inside route modals (e.g. SendTokenScreen in `(transactions-flow)`), and
  // the `actionMenuPopup()` host disables FWO — it paints UNDER a native iOS
  // route modal, leaving the menu invisible. The global-host routing (vs the
  // old inline heroui menu, which mis-positioned on Android) is preserved.
  const openMoreMenu = () => {
    actionMenuSheet({
      title: 'Select option',
      buttons: overflowMenuButtons.map((button, i) => ({
        text: typeof button.text === 'string' ? button.text : 'Action',
        icon: button.icon,
        description: button.description,
        disabled: button.disabled,
        variant: button.variant,
        testID: button.testID ?? (typeof button.text === 'string' ? button.text : `overflow-${i}`),
        // Fire-and-forget: the sheet host defers its auto-close until the
        // item's onPress settles, and overflow actions can be slow async ops
        // (Check Status, Cancel transaction). Returning void keeps the sheet
        // closing immediately on tap, matching the previous host's behavior.
        onPress: () => {
          void runMenuItemAction(button);
        },
      })),
    });
  };

  const handleButtonPress = (button: ButtonHandlerActionButton, idx: number) =>
    runButtonAction(button, idx, setLoadingIdx);

  return (
    <Log name="ButtonHandler">
      <HStack
        align="center"
        justify="space-between"
        className={`flex-row ${className || ''}`}
        style={[style]}>
        {visibleButtons.slice(0, 2).map((button, index) => (
          <View
            key={button.testID ?? (typeof button.text === 'string' ? button.text : `btn-${index}`)}
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0 }}>
            <Button
              testID={button.testID}
              onPress={() => handleButtonPress(button, index)}
              text={button.text}
              variant={button.variant}
              loading={loadingIdx === index || button.loading}
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
              onPress={() => handleButtonPress(visibleButtons[2], 2)}
              variant="secondary"
              loading={loadingIdx === 2 || visibleButtons[2].loading}
              disabled={visibleButtons[2].disabled}
            />
          </View>
        )}

        {/* 4+ buttons: "More" opens the app-wide actionMenuSheet listing items 3+. */}
        {visibleButtons.length > 3 && (
          <View>
            <Button
              testID="more-button"
              icon={<Icon name="tabler:dots" />}
              onPress={openMoreMenu}
              variant="secondary"
            />
          </View>
        )}
      </HStack>
    </Log>
  );
}
