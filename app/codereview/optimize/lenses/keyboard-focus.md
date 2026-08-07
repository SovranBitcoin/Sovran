# Lens: keyboard & input focus

Scope: composer, send/receive amount entry, search, settings forms, onboarding
inputs, any `TextInput`. The repo uses `react-native-keyboard-controller`
1.21 — prefer its primitives over bare `KeyboardAvoidingView`.

## Autofocus discipline

- Autofocus is the exception: acceptable only on single-purpose screens
  (amount pad, search, PIN) where typing is the sole action. Detect:
  `autoFocus` on multi-element screens.
- On modals/sheets, focus must wait for the transition to end (or use the
  navigator's `transitionEnd`) — focusing mid-animation causes jank and a
  mispositioned keyboard. Detect: `autoFocus` on modal-presented inputs;
  `.focus()` calls in mount effects of pushed screens.
- Focus re-asserted by a re-render after modal dismissal = keyboard popping
  back up. Detect: `.focus()` in render-adjacent code paths.

## Keeping inputs visible

- Forms >1 field in a plain `ScrollView` with no aware wrapper: flag —
  `KeyboardAwareScrollView` (keyboard-controller) is the sanctioned pattern.
- Submit CTAs below inputs need `KeyboardStickyView`/`KeyboardToolbar` or
  they're occluded at the worst moment.
- Bare `KeyboardAvoidingView` inside RN `Modal` or bottom sheets silently
  fails; sheets need `BottomSheetTextInput`.
- Frame-synced keyboard animation belongs in `useKeyboardHandler` +
  Reanimated, not `Keyboard.addListener` + setState (that's a per-frame
  re-render — cross-check render-perf lens).

## Tap & dismiss semantics

- Scrollables containing buttons need `keyboardShouldPersistTaps="handled"` —
  the default swallows the first tap to dismiss the keyboard, forcing
  double-taps on CTAs. Detect statically; composer and search surfaces first.
- Message/composer scrollers: `keyboardDismissMode="interactive"` on iOS,
  `"on-drag"` on Android.

## Focus across navigation

- Swipe-back can leave the keyboard up (react-navigation #12092 class).
  Screens with focused inputs should dismiss on blur/`beforeRemove` — and
  that teardown must fire on gesture dismissal too (cross-check
  dismiss-parity lens; report the root cause once).
- Known repo classes (don't re-report, look for *new* instances of the shape):
  receive back-nav dead Next (popup openSeq nonce), action-menu silent wedge.

## Evidence

```bash
rg -n "autoFocus" features app
rg -n "\.focus\(\)" features shared
rg -n "KeyboardAvoidingView" features shared        # each use = why not keyboard-controller?
rg -n "keyboardShouldPersistTaps" features shared   # inverse: scrollable+buttons without it
rg -n "keyboardDismissMode" features
rg -n "Keyboard\.addListener" features shared
```

## Do not flag

- Amount-pad screens using custom keypads (no system keyboard involved).
- `autoFocus` on the search screen / single-input flows.
