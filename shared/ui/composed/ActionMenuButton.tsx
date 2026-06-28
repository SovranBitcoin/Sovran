/**
 * Split-button action with a heroui-native Menu dropdown of alternate variants.
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
 * chevron that opens a Menu listing every variant (including the default, so the
 * user can re-pick it). Even when only one variant is available the chevron is
 * rendered (`alwaysShowMenu`), making forthcoming methods discoverable.
 *
 * Disabled variants remain visible in the menu with their `reason` rendered as a
 * `Menu.ItemDescription`, matching the pattern used by availability.ts in
 * colada.
 *
 * The Menu lifecycle (controlled open, mount-while-open, Portal/scrim, the
 * hidden-trigger anchoring workaround) lives in `BottomSheetMenu` — this
 * component only supplies the trigger layout and the menu items.
 */

import React, { useCallback } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Menu } from 'heroui-native';

import { Button } from '@/shared/ui/primitives/Button';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';
import { BottomSheetMenu } from '@/shared/blocks/popup/BottomSheetMenu';
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
   * When true (default) the chevron renders even if only one variant is
   * provided — keeps future methods discoverable. Set false to collapse to a
   * plain button when a single variant is given.
   */
  alwaysShowMenu?: boolean;
  /**
   * When true, the primary button also opens the menu instead of invoking the
   * default variant. Use when there is no sensible default (every variant is a
   * deliberate user choice).
   */
  collapsedPressOpensMenu?: boolean;
  /** Popover vs. bottom-sheet mode passed to Menu.Content. */
  presentation?: 'popover' | 'bottom-sheet';
  /** Optional heading rendered at the top of the Menu (e.g. "Select option"). */
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

export function ActionMenuButton({
  label,
  icon,
  testID,
  variant = 'primary',
  loading,
  disabled,
  variants,
  alwaysShowMenu = true,
  collapsedPressOpensMenu = false,
  presentation = 'popover',
  menuTitle,
  style,
  circle,
}: ActionMenuButtonProps) {
  const defaultVariant = variants[0];
  const hasVariants = variants.length > 0;
  const showChevron = hasVariants && (variants.length > 1 || alwaysShowMenu);

  const primaryDisabled = disabled || !hasVariants || defaultVariant?.isDisabled;

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
  const popoverWidth = presentation === 'popover' ? MENU_WIDTH : undefined;

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
    return (
      <BottomSheetMenu
        presentation={presentation}
        width={popoverWidth}
        name={testID ?? 'action-menu'}
        renderTrigger={({ open }) => (
          <CircleActionButton
            icon={circle.icon}
            systemIcon={circle.systemIcon}
            label={circle.label}
            testID={testID}
            disabled={disabled}
            onPress={open}
          />
        )}>
        {renderMenuItems(variants, testID, menuTitle)}
      </BottomSheetMenu>
    );
  }

  // Collapsed mode — no default, tapping anywhere opens the menu.
  if (collapsedPressOpensMenu) {
    return (
      <View style={[{ flex: 1 }, style]}>
        <BottomSheetMenu
          presentation={presentation}
          width={popoverWidth}
          name={testID ?? 'action-menu'}
          renderTrigger={({ open }) => (
            <Button
              testID={testID}
              text={label}
              icon={primaryIconNode}
              variant={variant}
              loading={loading}
              disabled={disabled}
              onPress={open}
            />
          )}>
          {renderMenuItems(variants, testID, menuTitle)}
        </BottomSheetMenu>
      </View>
    );
  }

  // Single-variant + !alwaysShowMenu → plain button, no chevron, no Menu.
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

  // Default — split button (primary + chevron Menu trigger).
  return (
    <BottomSheetMenu
      presentation={presentation}
      width={popoverWidth}
      name={testID ?? 'action-menu'}
      renderTrigger={({ open }) => (
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
            onPress={open}
          />
        </HStack>
      )}>
      {renderMenuItems(variants, testID, menuTitle)}
    </BottomSheetMenu>
  );
}

function renderMenuItems(
  variants: ActionMenuVariant[],
  rootTestID: string | undefined,
  title: string | undefined
) {
  return (
    <>
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
          <HStack align="center" gap={10} style={{ flex: 1 }}>
            {v.iconNode ?? (v.icon ? <Icon name={v.icon} size={18} /> : null)}
            <View style={{ flex: 1 }}>
              <Menu.ItemTitle>{v.label}</Menu.ItemTitle>
              {(v.description || (v.isDisabled && v.reason)) && (
                <Menu.ItemDescription>
                  {v.isDisabled && v.reason ? v.reason : v.description}
                </Menu.ItemDescription>
              )}
            </View>
          </HStack>
        </Menu.Item>
      ))}
    </>
  );
}
