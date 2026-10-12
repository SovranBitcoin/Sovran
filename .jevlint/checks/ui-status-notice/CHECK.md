Where does JSX hand-build a status notice instead of using the shared Notice in app/shared/ui/composed/Notice.tsx?

A status notice has three visible parts: a container drawing its own tinted or bordered surface
(bg-warning-soft, bg-danger-soft, bg-danger/[0.08], withAlpha(dangerColor, ...), an amber or red
hex, or an explicit border), a status icon, and a sentence telling the user what happened. Find
components with all three, plus Notice itself for comparison. These are different shapes, not
notices: toasts and overlays (StatusToast, ToastSlab, CompactToast, PaymentStatusToast,
SwapStatusToast, anything spreading toastProps), a tint marking one existing row's state,
full-screen error or empty states, screen-wide banners, call-to-action cards, badges and pills,
field validation text, and tinted copy with no surface. A small named component whose body is a
Notice is the intended pattern. The design-system catalogue under app/features/settings is exempt.
