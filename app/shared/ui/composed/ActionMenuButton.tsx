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
 * - `popover` (default): a menu anchored above the button. **iOS only** —
 *   Android always routes through the global host regardless of this prop.
 * - `bottom-sheet`: routed through `actionMenuSheet()` — the custom-sheet
 *   lane on `PopupHost`, sequenced with the other popups (the amount-screen
 *   "Next" chooser). Android's default-popover path falls back to the
 *   `actionMenuPopup` global host.
 *
 * Disabled variants remain visible with their `reason` rendered as the
 * description, matching the pattern used by availability.ts in colada.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View as RNView,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Button } from '@/shared/ui/primitives/Button';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { View } from '@/shared/ui/primitives/View/View';
import { FOOTER_GAP } from '@/shared/ui/composed/footerInset';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import {
  MenuItem,
  MenuRowTint,
  MenuTitle,
  SheetMenuRowContent,
} from '@/shared/lib/popup/popups/sheetMenuRow';
import Icon from 'assets/icons';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { alpha } from '@/shared/styles/tokens';
import { OverlayWindow } from '@/shared/ui/composed/Sheet';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import {
  actionMenuPopup,
  getActionMenuSnapshot,
  replaceActionMenuPopup,
  type ActionMenuItem,
} from '@/shared/lib/popup/popups/actionMenu';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
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
  /** Yellow caution tint: the option works but carries a caveat. */
  isCaution?: boolean;
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
  const itemTestID = v.testID ?? `${rootTestID ?? 'action-menu-button'}-menu-${v.id}`;
  return {
    text: v.label,
    icon: v.icon,
    iconNode: v.iconNode,
    description: v.description ?? (v.isDisabled ? v.reason : undefined),
    disabled: v.isDisabled,
    reason: v.reason,
    variant: v.isDestructive ? 'dangerous' : undefined,
    isCaution: v.isCaution,
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
  // Android has no anchored popover: the default-popover path routes through
  // the global host there. iOS keeps the requested presentation (anchored popover by default).
  const isBottomSheet = useFwoSheet || Platform.OS === 'android';

  const primaryDisabled = disabled || !hasVariants || defaultVariant?.isDisabled;

  // The popover anchors to an invisible 1×1 view laid out beside the trigger
  // and measured when the menu opens. The bottom-sheet path skips it and
  // dispatches to the global actionMenuPopup host.
  const anchorRef = useRef<RNView>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const openPresentation = useRef<{ kind: 'sheet' | 'menu'; seq: number } | null>(null);
  useEffect(() => {
    const owner = openPresentation.current;
    if (!owner) return;
    const payload = { title: menuTitle, buttons: variants.map((v) => toActionMenuItem(v, testID)) };
    if (owner.kind === 'sheet') {
      usePopupStore.getState().updateActionMenu(owner.seq, payload);
    } else {
      const current = getActionMenuSnapshot();
      if (current.payload && current.seq === owner.seq) replaceActionMenuPopup(payload);
    }
  }, [variants, menuTitle, testID]);
  const openMenu = useCallback(() => {
    if (useFwoSheet) {
      // FWO lane — stacks above route modals (the amount-screen Next chooser
      // lives inside `(send-flow)`).
      actionMenuSheet({
        title: menuTitle,
        buttons: variants.map((v) => toActionMenuItem(v, testID)),
      });
      openPresentation.current = { kind: 'sheet', seq: usePopupStore.getState().openSeq };
      return;
    }
    if (isBottomSheet) {
      actionMenuPopup({
        title: menuTitle,
        buttons: variants.map((v) => toActionMenuItem(v, testID)),
      });
      openPresentation.current = { kind: 'menu', seq: getActionMenuSnapshot().seq };
      return;
    }
    anchorRef.current?.measureInWindow((x, y) => setAnchor({ x, y }));
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
      <>
        <RNView
          ref={anchorRef}
          collapsable={false}
          pointerEvents="none"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
        />
        {trigger}
        {anchor ? (
          <MenuPopover
            anchor={anchor}
            variants={variants}
            rootTestID={testID}
            title={menuTitle}
            onClose={() => setAnchor(null)}
          />
        ) : null}
      </>
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
    <HStack align="center" gap={FOOTER_GAP} style={[{ flex: 1 }, style]}>
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

/**
 * The anchored menu: a scrim and a 260pt card whose bottom sits just above
 * the anchor and whose trailing edge aligns with it, kept 12pt inside the
 * screen. A pick closes it, then runs the variant.
 */
function MenuPopover({
  anchor,
  variants,
  rootTestID,
  title,
  onClose,
}: {
  anchor: { x: number; y: number };
  variants: ActionMenuVariant[];
  rootTestID: string | undefined;
  title: string | undefined;
  onClose: () => void;
}) {
  const window = useWindowDimensions();
  const scrimColor =
    useColorScheme() === 'light'
      ? `rgba(255,255,255,${alpha.strong})`
      : `rgba(0,0,0,${alpha.strong})`;
  const left = Math.min(Math.max(anchor.x + 1 - MENU_WIDTH, 12), window.width - MENU_WIDTH - 12);
  return (
    <OverlayWindow>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(200)}
        style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]}>
        <Pressable
          testID="action-menu-dismiss"
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
          activeOpacity={1}
          style={StyleSheet.absoluteFill}
          // Tapping the scrim away is not an action; it stays silent.
          haptics={false}
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        entering={FadeIn.duration(200)}
        className="bg-overlay shadow-overlay absolute rounded-3xl px-1.5 py-3"
        style={{
          left,
          width: MENU_WIDTH,
          bottom: window.height - anchor.y + 8,
          borderCurve: 'continuous',
        }}>
        {title ? <MenuTitle>{title}</MenuTitle> : null}
        {variants.map((v) => {
          const itemTestID = v.testID ?? (rootTestID ? `${rootTestID}-menu-${v.id}` : undefined);
          return (
            <MenuRowTint
              key={v.id}
              tone={v.isCaution ? 'caution' : undefined}
              disabled={v.isDisabled === true}>
              <MenuItem
                testID={itemTestID}
                isDisabled={v.isDisabled}
                variant={v.isDestructive ? 'danger' : 'default'}
                onPress={() => {
                  if (v.isDisabled) return;
                  onClose();
                  void (async () => {
                    try {
                      await v.onPress();
                    } catch (error) {
                      log.error('ui.action_menu.menu_action_failed', {
                        testID: itemTestID,
                        variantId: v.id,
                        error: error instanceof Error ? error.message : String(error),
                      });
                    }
                  })();
                }}>
                <SheetMenuRowContent
                  singleLineTitle={false}
                  icon={v.iconNode ?? (v.icon ? <Icon name={v.icon} size={18} /> : null)}
                  title={v.label}
                  description={(v.isDisabled && v.reason ? v.reason : v.description) || undefined}
                />
              </MenuItem>
            </MenuRowTint>
          );
        })}
      </Animated.View>
    </OverlayWindow>
  );
}
