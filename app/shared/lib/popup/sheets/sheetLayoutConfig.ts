import type { CustomSheetId, SheetLayoutConfig } from './types';

export const SHEET_LAYOUT_CONFIG: Record<CustomSheetId, SheetLayoutConfig> = {
  // Generic action-menu auto-fits: typically 1–4 short rows, same as the
  // menu-lane equivalent (`actionMenuPopup` with no footer).
  'action-menu': { mode: 'contentHeight' },
  'emoji-picker': { mode: 'snapPoints', snapPoints: ['80%'] },
  // Model picker auto-fits — title + tab strip + up to three tier rows, the
  // same shape as the action menu above.
  //
  // It used to ask for `snapPoints: ['50%']`, and on device its rows AND its
  // tab pills took no taps at all: six opens, `modelPicker.rows` reporting two
  // and three pressable rows, and not one `modelPicker.select` or
  // `modelPicker.tab.switch` (app/log.txt, 2026-09-25). The rows are heroui
  // `Menu.Item`s and the pills are our own `Pressable`, so nothing they share
  // is in the press path — what they share is this mode.
  //
  // `snapPoints` puts the sheet body in a container shape nothing else in the
  // app uses. `PopupHost` gives snapPoints sheets `useDirectView: true`, which
  // swaps gorhom's `BottomSheetView` for a plain `View`, and dresses it
  // `h-full` + heroui's `flex-1`. `BottomSheetView` is `position: absolute` and
  // sizes to its own content, so it never asks its parent how tall it is. The
  // plain View does: both `height: 100%` and `flex: 1` resolve against the
  // content mask, whose height is a *reanimated* animated style that is absent
  // entirely until gorhom has measured the container. Layout that depends on an
  // animated parent height is layout the shadow tree can disagree with the
  // native view about, and a native view whose frame disagrees with Yoga is
  // exactly a surface you can see and cannot hit.
  //
  // `contentHeight` is the lane every sheet with a demonstrated tap record uses
  // (`action-menu`, `payment-options`, `proof-selector` — the e2e mint-fault
  // scenarios press their rows by coordinate on iOS and get the effect). The
  // picker has no virtualized list, so it has nothing to gain from the fixed
  // detent, and `maxDynamicContentSize` still caps it below the status bar.
  'model-picker': { mode: 'contentHeight' },
  // Payment options auto-fit: typical N is 1–3 rows, and the menu-lane
  // equivalent (`actionMenuPopup` with no footer) also uses dynamic sizing.
  'payment-options': { mode: 'contentHeight' },
  'payment-fallback': { mode: 'contentHeight' },
  'proof-selector': { mode: 'contentHeight' },
  'send-memo': { mode: 'contentHeight' },
  // Signer sheets auto-fit, but their expandable sections (raw-event Details,
  // the pairing preset list, follow-diff rows) can push past the dynamic-size
  // cap — `scrollable` swaps the clipped BottomSheetView for a gorhom
  // scrollable so the body scrolls instead.
  'signer-approval': { mode: 'contentHeight', scrollable: true },
  'signer-connect': { mode: 'contentHeight', scrollable: true },
  // Only ever pushed inside the signer-connect sheet, so the root's layout
  // governs at runtime; the entry exists because the registry is total.
  'signer-profile-picker': { mode: 'contentHeight', scrollable: true },
  // Tap-to-pay auto-fits: pulsing glyph + two text lines + Close footer.
  'nfc-tap': { mode: 'contentHeight' },
};
