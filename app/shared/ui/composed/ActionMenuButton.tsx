/**
 * Split-button action with a dropdown of alternate variants.
 *
 * Usage:
 *   <ActionMenuButton
 *     label="Copy"
 *     icon="lets-icons:copy"
 *     testID="send-token-copy"
 *     variant="primary"
 *     variants={[
 *       { id: 'text',  label: 'as Text',  onPress: () => copy.execute({ variantId: 'text' }) },
 *       { id: 'emoji', label: 'as Emoji', onPress: () => copy.execute({ variantId: 'emoji' }) },
 *     ]}
 *   />
 *
 * Renders a full-width primary button backed by `variants[0]`, flush alongside a
 * chevron that opens a menu listing every variant (including the default, so the
 * user can re-pick it). Even when only one variant is available the chevron is
 * rendered (`alwaysShowMenu`), making forthcoming methods discoverable.
 *
 * Two presentations:
 * - `popover` (default): an inline anchored heroui Menu. **iOS only** — on
 *   Android the inline popover relies on heroui's async `measure()` to position
 *   its portal, and that callback is routinely slow/stale/dropped on Android, so
 *   the menu intermittently fails to open (first tap does nothing). Android
 *   therefore always routes through the global host regardless of this prop.
 * - `bottom-sheet`: routed through `actionMenuSheet()` — the FullWindowOverlay-
 *   backed `<BottomSheet>` lane on `PopupHost`. Unlike the `actionMenuPopup()`
 *   menu-lane host (which disables FWO and paints UNDER route modals), this
 *   stacks above `(send-flow)` modals, so in-modal CTAs like the amount-screen
 *   "Next" chooser are visible. Android's default-popover path still falls back
 *   to the `actionMenuPopup` global host (inline popover mis-measures there).
 *
 * Disabled variants remain visible with their `reason` rendered as the
 * description, matching the pattern used by availability.ts in colada.
 */

import React, { useCallback, useRef } from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import { Menu, type MenuTriggerRef } from 'heroui-native';

import { Button } from '@/shared/ui/primitives/Button';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { SheetMenuRowContent } from '@/shared/lib/popup/popups/sheetMenuRow';
import Icon from 'assets/icons';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { actionMenuPopup, type ActionMenuItem } from '@/shared/lib/popup/popups/actionMenu';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { log } from '@/shared/lib/logger';

export interface ActionMenuVariant {
  /** Stable id — e.g. 'text' | 'emoji' | 'ecash' | 'lightning' | 'offlineEcash' | 'onchain'. */
  id: string;
  /** Primary label shown in the menu (e.g. "as Lightning"). */
  label: string;
  /** Secondary caption rendered below the label. */
  description?: string;
  /** iconify name, rendered as the item's leading glyph. */
  icon?: string;
  /** Custom leading glyph node (takes precedence over `icon`). Use when the
   * variant needs an emoji or other non-iconify visual — e.g. the Marmot
   * protocol identity. */
  iconNode?: React.ReactNode;
  /** Hides the item from tap but keeps it visible with the reason as description. */
  isDisabled?: boolean;
  /** Reason the variant is unavailable — rendered as the description when disabled. */
  reason?: string;
  /** Red destructive styling. */
  isDestructive?: boolean;
  /** Override the default testID `${rootTestID}-menu-${id}`. */
  testID?: string;
  onPress: () => void | Promise<void>;
}

interface ActionMenuButtonProps {
  /** Label shown on the primary button. */
  label: string;
  /** iconify name for the primary button. */
  icon?: string;
  /** Root testID. Primary button uses this; chevron uses `${testID}-menu`. */
  testID?: string;
  variant?: 'primary' | 'secondary' | 'dangerous';
  loading?: boolean;
  /** When true, both the primary and chevron are unresponsive. */
  disabled?: boolean;
  /**
   * First entry is the default primary action; remaining entries populate the
   * menu. If `variants.length === 0` the button renders disabled with no menu.
   */
  variants: ActionMenuVariant[];
  /**
   * When true, the primary button also opens the menu instead of invoking the
   * default variant. Use when there is no sensible default (every variant is a
   * deliberate user choice).
   */
  collapsedPressOpensMenu?: boolean;
  /** Popover (default, inline anchored menu) vs. bottom-sheet (global host). */
  presentation?: 'popover' | 'bottom-sheet';
  /** Optional heading rendered at the top of the menu (e.g. "Select option"). */
  menuTitle?: string;
  /** Style applied to the outer HStack container. */
  style?: StyleProp<ViewStyle>;
  /**
   * Render the trigger as a `CircleActionButton` (the Swap/NFC/More wallet
   * affordance) instead of a full-width `Button`. Tapping it always opens the
   * menu — there is no default action. Use where the action belongs to a row of
   * icon buttons rather than a footer CTA (e.g. the profile Send Message).
   */
  circle?: { icon: string; systemIcon?: string; label: string };
}

const MENU_WIDTH = 260;

/** Map a variant to an `actionMenuPopup` item, wrapping onPress error logging. */
function toActionMenuItem(v: ActionMenuVariant, rootTestID: string | undefined): ActionMenuItem {
  const itemTestID = v.testID ?? (rootTestID ? `${rootTestID}-menu-${v.id}` : undefined);
  return {
    text: v.label,
    icon: v.icon,
    iconNode: v.iconNode,
    description: v.description ?? (v.isDisabled ? v.reason : undefined),
    disabled: v.isDisabled,
    reason: v.reason,
    variant: v.isDestructive ? 'dangerous' : undefined,
    testID: itemTestID,
    onPress: async () => {
      try {
        await v.onPress();
      } catch (error) {
        log.error('ui.action_menu.menu_action_failed', {
          testID: itemTestID,
          variantId: v.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function ActionMenuButton({
  label,
  icon,
  testID,
  variant = 'primary',
  loading,
  disabled,
  variants,
  collapsedPressOpensMenu = false,
  presentation = 'popover',
  menuTitle,
  style,
  circle,
}: ActionMenuButtonProps) {
  const defaultVariant = variants[0];
  const hasVariants = variants.length > 0;
  const showChevron = hasVariants;
  // An explicit `bottom-sheet` request routes through the FullWindowOverlay-
  // backed `<BottomSheet>` lane (`actionMenuSheet`) so the menu stacks ABOVE
  // route modals — the menu-lane host (`actionMenuPopup`) disables FWO and
  // paints under any `(send-flow)` modal, hiding the chooser.
  const useFwoSheet = presentation === 'bottom-sheet';
  // On Android the inline popover races heroui's async `measure()` and can fail
  // to open, so the default-popover path also routes through a global host
  // there. iOS keeps the requested presentation (anchored popover by default).
  const isBottomSheet = useFwoSheet || Platform.OS === 'android';

  const primaryDisabled = disabled || !hasVariants || defaultVariant?.isDisabled;

  // heroui-native `Menu.Trigger asChild` routes through `Slot.Pressable`, which
  // only composes onPress cleanly with children that are themselves a
  // `Pressable`. Our `Button` primitive wraps a custom `TouchableOpacity`, so
  // for the popover path we render an invisible absolute-positioned Trigger and
  // open it imperatively via ref. The bottom-sheet path skips the inline Menu
  // entirely and dispatches to the global actionMenuPopup host.
  const menuTriggerRef = useRef<MenuTriggerRef>(null);
  const openMenu = useCallback(() => {
    if (useFwoSheet) {
      // FWO lane — stacks above route modals (the amount-screen Next chooser
      // lives inside `(send-flow)`).
      actionMenuSheet({
        title: menuTitle,
        buttons: variants.map((v) => toActionMenuItem(v, testID)),
      });
      return;
    }
    if (isBottomSheet) {
      actionMenuPopup({
        title: menuTitle,
        buttons: variants.map((v) => toActionMenuItem(v, testID)),
      });
      return;
    }
    // Defer to the next tick so the Button's press animation doesn't race
    // with the Trigger's `measure()` call inside heroui's `.open()`.
    setTimeout(() => menuTriggerRef.current?.open(), 0);
  }, [useFwoSheet, isBottomSheet, variants, menuTitle, testID]);

  const handlePrimaryPress = useCallback(async () => {
    if (!defaultVariant || primaryDisabled) return;
    try {
      await defaultVariant.onPress();
    } catch (error) {
      log.error('ui.action_menu.primary_action_failed', {
        testID,
        variantId: defaultVariant.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [defaultVariant, primaryDisabled, testID]);

  const primaryIconNode = icon ? <Icon name={icon} size={18} /> : undefined;

  // Wrap a trigger node in the inline popover Menu (anchored). For bottom-sheet
  // the trigger stands alone — openMenu dispatches to the global host.
  const withMenu = (trigger: React.ReactNode) => {
    if (isBottomSheet) return <>{trigger}</>;
    return (
      <Menu presentation="popover">
        <Menu.Trigger
          ref={menuTriggerRef}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          <View style={{ width: 1, height: 1 }} />
        </Menu.Trigger>
        {trigger}
        {renderPopoverPortal(variants, testID, menuTitle)}
      </Menu>
    );
  };

  // When there are no variants, render a disabled primary button. No menu.
  if (!hasVariants) {
    return (
      <View style={[{ flex: 1 }, style]}>
        <Button
          testID={testID}
          text={label}
          icon={primaryIconNode}
          variant={variant}
          loading={loading}
          disabled
          onPress={() => {}}
        />
      </View>
    );
  }

  // Circle trigger — render the icon button in a row of CircleActionButtons.
  // Tapping always opens the menu, since there is no sensible default.
  if (circle) {
    return withMenu(
      <CircleActionButton
        icon={circle.icon}
        systemIcon={circle.systemIcon}
        label={circle.label}
        testID={testID}
        disabled={disabled}
        onPress={openMenu}
      />
    );
  }

  // Collapsed mode — no default, tapping anywhere opens the menu.
  if (collapsedPressOpensMenu) {
    return (
      <View style={[{ flex: 1 }, style]}>
        {withMenu(
          <Button
            testID={testID}
            text={label}
            icon={primaryIconNode}
            variant={variant}
            loading={loading}
            disabled={disabled}
            onPress={openMenu}
          />
        )}
      </View>
    );
  }

  // Single-variant + !alwaysShowMenu → plain button, no chevron, no menu.
  if (!showChevron) {
    return (
      <View style={[{ flex: 1 }, style]}>
        <Button
          testID={testID}
          text={label}
          icon={primaryIconNode}
          variant={variant}
          loading={loading}
          disabled={primaryDisabled}
          onPress={handlePrimaryPress}
        />
      </View>
    );
  }

  // Default — split button (primary + chevron menu trigger).
  return withMenu(
    <HStack align="center" gap={0} style={[{ flex: 1 }, style]}>
      <View style={{ flex: 1 }}>
        <Button
          testID={testID}
          text={label}
          icon={primaryIconNode}
          variant={variant}
          loading={loading}
          disabled={primaryDisabled}
          onPress={handlePrimaryPress}
        />
      </View>
      <Button
        testID={testID ? `${testID}-menu` : undefined}
        icon={<Icon name="mdi:chevron-down" size={20} />}
        variant={variant}
        disabled={disabled}
        onPress={openMenu}
      />
    </HStack>
  );
}

function renderPopoverPortal(
  variants: ActionMenuVariant[],
  rootTestID: string | undefined,
  title: string | undefined
) {
  return (
    <Menu.Portal disableFullWindowOverlay={Platform.OS === 'android'}>
      <MenuScrim />
      <Menu.Content presentation="popover" placement="top" align="end" width={MENU_WIDTH}>
        {title ? (
          <Menu.Label className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
            {title}
          </Menu.Label>
        ) : null}
        {variants.map((v) => (
          <Menu.Item
            key={v.id}
            testID={v.testID ?? (rootTestID ? `${rootTestID}-menu-${v.id}` : undefined)}
            isDisabled={v.isDisabled}
            variant={v.isDestructive ? 'danger' : 'default'}
            onPress={() => {
              if (v.isDisabled) return;
              void (async () => {
                try {
                  await v.onPress();
                } catch (error) {
                  log.error('ui.action_menu.menu_action_failed', {
                    testID: v.testID ?? (rootTestID ? `${rootTestID}-menu-${v.id}` : undefined),
                    variantId: v.id,
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              })();
            }}>
            <SheetMenuRowContent
              icon={v.iconNode ?? (v.icon ? <Icon name={v.icon} size={18} /> : null)}
              title={v.label}
              description={(v.isDisabled && v.reason ? v.reason : v.description) || undefined}
            />
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Portal>
  );
}
