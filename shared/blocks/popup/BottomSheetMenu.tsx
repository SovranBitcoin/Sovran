/**
 * Controlled heroui-native Menu that only mounts its portal/sheet subtree while
 * open. Replaces the repeated "hidden 1x1 absolute Menu.Trigger +
 * setTimeout(ref.open())" boilerplate the uncontrolled call sites shared.
 *
 * Why this exists — the Android bug it fixes:
 * heroui-native's `<Menu presentation="bottom-sheet">` hides its CLOSED state by
 * animation/position alone — gorhom `index={-1}` + a reanimated-driven
 * `animatedIndex`, with the overlay `forceMount`-ed. There is no unmount and no
 * `display:none`. On Android a freshly-mounted closed sheet paints at rest
 * (the gorhom/reanimated position never settles off-screen on first frame), so
 * the menu is permanently visible until interacted with. iOS never hit this
 * because the sheet usages there route through a different native path. The one
 * usage that already worked — `ActionMenuHost` — is controlled; this module
 * generalizes that pattern so a closed menu renders *nothing*.
 *
 * - bottom-sheet (default): fully controlled, no Trigger needed (the sheet
 *   reads `isOpen` from Menu context). `open()` mounts the subtree, then flips
 *   `isOpen` true on the next frame so heroui sees a false->true transition and
 *   fires its `snapToIndex` open animation (mounting with `isOpen` already true
 *   skips that effect and the sheet never opens). On close we keep the subtree
 *   mounted for one animation, then unmount — so at rest nothing is in the tree.
 * - popover: keeps a hidden Trigger so heroui can measure/anchor, opens
 *   imperatively via `ref.open()`, and leaves content mounted. The popover path
 *   hides its closed state via `isReady`/opacity and is not affected by the
 *   Android bug, so it is left structurally unchanged.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Menu, type MenuTriggerRef } from 'heroui-native';

import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { View } from '@/shared/ui/primitives/View/View';
import { log } from '@/shared/lib/logger';

/**
 * Hold the sheet mounted briefly after it closes so gorhom's spring and the
 * scrim fade (200ms) finish before we unmount. A little slack past the scrim
 * keeps the close animation intact.
 */
const SHEET_CLOSE_MS = 400;

type BottomSheetMenuPresentation = 'bottom-sheet' | 'popover';

interface BottomSheetMenuRenderArgs {
  /** Open the menu — wire your control's `onPress` to this. */
  open: () => void;
  /** Whether the menu is currently open. */
  isOpen: boolean;
}

interface BottomSheetMenuProps {
  /** Sheet (default) or anchored popover. */
  presentation?: BottomSheetMenuPresentation;
  /** Renders the trigger; wire the control's `onPress` to `open`. */
  renderTrigger: (args: BottomSheetMenuRenderArgs) => React.ReactNode;
  /** Menu body — `Menu.Label` / `Menu.Item` children. */
  children: React.ReactNode;
  /** Popover placement (ignored for bottom-sheet). */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Popover alignment (ignored for bottom-sheet). */
  align?: 'start' | 'center' | 'end';
  /** Popover fixed width (ignored for bottom-sheet). */
  width?: number;
  /** Notified on every open-state change, after internal state is updated. */
  onOpenChange?: (open: boolean) => void;
  /** Diagnostics label for the open/close log line. */
  name?: string;
}

export function BottomSheetMenu({
  presentation = 'bottom-sheet',
  renderTrigger,
  children,
  placement = 'top',
  align = 'end',
  width,
  onOpenChange,
  name,
}: BottomSheetMenuProps): React.ReactElement {
  const isBottomSheet = presentation === 'bottom-sheet';
  const [isOpen, setIsOpen] = useState(false);
  // Sheet path: gate the Portal so nothing renders while idle. Popover keeps
  // its content mounted (it isn't affected by the Android closed-state bug and
  // needs to be present to measure/anchor).
  const [sheetMounted, setSheetMounted] = useState(false);
  const triggerRef = useRef<MenuTriggerRef>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = () => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
  };

  useEffect(() => clearPending, []);

  const open = useCallback(() => {
    if (isBottomSheet) {
      log.debug('ui.bottom_sheet_menu.open', { name, presentation });
      clearPending();
      setSheetMounted(true);
      // Flip to open on the next tick so heroui sees a false->true transition
      // (mounting with isOpen=true skips its snapToIndex open effect, so the
      // sheet would never animate up).
      pendingTimer.current = setTimeout(() => {
        setIsOpen(true);
        pendingTimer.current = null;
      }, 0);
      return;
    }
    // Popover: imperative open measures the hidden trigger for anchoring; the
    // resulting onOpenChange(true) drives our controlled isOpen.
    setTimeout(() => triggerRef.current?.open(), 0);
  }, [isBottomSheet, name, presentation]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setIsOpen(next);
      onOpenChange?.(next);
      if (next) {
        if (!isBottomSheet) {
          log.debug('ui.bottom_sheet_menu.open', { name, presentation });
        }
        return;
      }
      log.debug('ui.bottom_sheet_menu.close', { name, presentation });
      if (isBottomSheet) {
        // Keep the subtree mounted for one close animation, then unmount so the
        // closed sheet is never in the tree at rest.
        clearPending();
        pendingTimer.current = setTimeout(() => {
          setSheetMounted(false);
          pendingTimer.current = null;
        }, SHEET_CLOSE_MS);
      }
    },
    [isBottomSheet, name, onOpenChange, presentation]
  );

  const renderContent = isBottomSheet ? sheetMounted : true;

  return (
    <Menu presentation={presentation} isOpen={isOpen} onOpenChange={handleOpenChange}>
      {!isBottomSheet && (
        <Menu.Trigger
          ref={triggerRef}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          <View style={{ width: 1, height: 1 }} />
        </Menu.Trigger>
      )}
      {renderTrigger({ open, isOpen })}
      {renderContent &&
        (isBottomSheet ? (
          // Keep iOS on FullWindowOverlay (so an open sheet can sit above native
          // modals); Android opts out — the closed-state fix is the mount gate
          // above, not the overlay window.
          <Menu.Portal disableFullWindowOverlay={Platform.OS === 'android'}>
            <MenuScrim />
            <Menu.Content presentation="bottom-sheet">{children}</Menu.Content>
          </Menu.Portal>
        ) : (
          <Menu.Portal disableFullWindowOverlay={Platform.OS === 'android'}>
            <MenuScrim />
            <Menu.Content presentation="popover" placement={placement} align={align} width={width}>
              {children}
            </Menu.Content>
          </Menu.Portal>
        ))}
    </Menu>
  );
}
