# Menus opened from native modals

Menus opened by a native modal must use a host above that modal. For plain
title/buttons/onDismiss action menus, use `actionMenuSheet`: its `PopupHost`
owns the iOS `FullWindowOverlay` and Android hardware Back handling through
the house `Sheet` primitive (`app/shared/ui/composed/Sheet.tsx`).

Verify stacking independently on Android, where the iOS overlay wrapper is a
no-op. A component's name alone does not establish its native window ownership:
trace the opener and host together.

The nearby-send decisions use the sheet lane. Native verification must open
the decision from the active modal, operate an action, dismiss it and return
to the invoking screen on each platform.
