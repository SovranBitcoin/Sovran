# Menus opened from native modals

Menus opened by a native modal must use a host above that modal. For plain
title/buttons/onDismiss action menus, use `actionMenuSheet`: its PopupHost
owns the iOS FullWindowOverlay. `actionMenuPopup` uses the HeroUI Menu host
with that overlay disabled and can hide a required decision behind the route.

Do not enable the overlay on that host globally; HeroUI Menu has a separate
mounting constraint there. Verify stacking independently on Android, where
the overlay wrapper is a no-op. A component's name alone does not establish
its native window ownership: trace the opener and host together.

The nearby-send decisions use the sheet lane. Native verification must open
the decision from the active modal, operate an action, dismiss it and return
to the invoking screen on each platform.
