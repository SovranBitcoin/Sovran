# Issue: Image overlay tap-to-close animation fails after a prior drag-to-close

## Summary

When dismissing the fullscreen image overlay by **tapping outside** the image, the close animation (spring + blur) sometimes does **not** run—the overlay disappears instantly. This happens **reliably** after the user has previously closed the overlay by **dragging** (pan-to-dismiss). If the user has only ever used tap-outside to close, the animation works every time.

## Reproduction

1. Open an image in the fullscreen overlay (tap a thumbnail in the feed).
2. **Drag** to dismiss (pan down/away past the threshold so it closes with the spring animation).
3. Open **another** (or the same) image again in the overlay.
4. Dismiss by **tapping outside** the image (on the dark backdrop).
5. **Actual:** The overlay closes but **without** the spring/blur close animation (instant disappear).
6. **Expected:** The same spring + blur close animation as when using tap-outside the first time, or when using the close button.

## What works

- **Tap outside → close** (first time, or when the previous close was also tap-outside): animation runs.
- **Drag to close**: animation runs.
- **Close button**: animation runs.
- **Tap outside → close** when the **previous** close was **drag**: overlay closes but **no** animation.

## Technical context

### Architecture

- **Provider:** `components/blocks/nostr/image-overlay-provider.tsx`  
  - Holds shared values: `imageXCoord`, `imageYCoord`, `imageWidth`, `imageHeight`, `blurIntensity`, `closeBtnOpacity`, `imageState`, `isClosing`, etc.  
  - `close()` is a **worklet** that sets `isClosing = true`, runs `withSpring` on position/size and `withTiming` on blur/opacity to the thumbnail target, and on the 4th spring completion calls `scheduleOnRN(finishClose)`. `finishClose` sets `imageState = 'close'`, `isClosing = false`, and clears `activeUrl` after a short delay.  
  - `open()` is a **JS callback**: sets React state, shared values (thumbnail position + targets), then either started `withTiming` from JS to expand to center or (after attempted fix) calls `scheduleOnUI(openToCenter)` so the expand runs on the UI thread.  
  - `openToCenter()` is a worklet that runs `withTiming` to center/fullscreen.

- **Overlay:** `components/blocks/nostr/animated-image-overlay.tsx`  
  - Uses `Gesture.Exclusive(pan, tapBackdrop)`. Pan has `minDistance(10)` so taps don't trigger pan.  
  - **Tap outside:** Tap `onEnd` → hit-test outside image → `runOnJS(triggerClose)()` → `triggerClose()` calls `scheduleOnUI(closeRef.current)` so `close()` runs on the UI thread.  
  - **Drag to close:** Pan `onFinalize` → if `dismissed`, calls `close()` directly (already on UI thread).  
  - **Close button:** `onPress={triggerClose}` → `scheduleOnUI(closeRef.current)`.

### Hypothesis (why drag then tap breaks animation)

1. **Pan-close** runs entirely on the **UI thread** (gesture → `close()` worklet → `withSpring`/`withTiming`). When the springs finish, the last writes to `imageXCoord`, etc. happen in spring callbacks on the UI thread.
2. **Open** runs on the **JS thread**. It sets shared values and (before fix) started `withTiming` from JS to expand to center. There may be a Reanimated/threading behavior where **starting a new animation from the JS thread on shared values that were just animated on the UI thread** does not run correctly (e.g. the expand `withTiming` never runs or is dropped).
3. So after "drag to close → open again", the expand animation might never run; values stay at thumbnail. When the user **tap-to-closes**, `close()` runs and does `withSpring(x, …)` etc. If current value is already at thumbnail, **current === target**, so springs complete immediately → no visible animation; overlay still closes because `finishClose` runs.

### What was tried (did not fix)

- **Stale close reference:** Using a ref for `close` and `runOnJS(triggerClose)()` → `scheduleOnUI(closeRef.current)` so tap always invokes the current `close`. Tap-outside still fails after a prior drag-close.
- **isClosing / double-close guard:** Early-return in `close()` if `imageState !== 'open'` or `isClosing.value`. No change.
- **Pan vs tap:** `Pan().minDistance(10)` so tap wins when there's no movement. No change.
- **Run expand on UI thread:** In `open()`, stop starting `withTiming` from JS; instead call `cancelAnimation` on the position/size/blur shared values, then `scheduleOnUI(openToCenter)` so the expand-to-center animation runs on the UI thread. Issue persisted for the reporter.
- **cancelAnimation in open():** Cancel any in-flight animation on `imageXCoord`, `imageYCoord`, `imageWidth`, `imageHeight`, `blurIntensity`, `closeBtnOpacity` before scheduling `openToCenter`. Issue persisted.

So the root cause is likely deeper (e.g. Reanimated internal state after UI-thread animations, or gesture handler state after `Gesture.Exclusive` with pan + tap).

## Environment

- React Native + Expo (project: Sovran).
- `react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets` (scheduleOnUI / scheduleOnRN).
- Fullscreen overlay uses `FullWindowOverlay` from `react-native-screens` on native.

## Possible next steps

- Reproduce with Reanimated/gesture-handler at specific versions and check release notes / issues for "animation from JS after UI animation" or "shared value not animating".
- Add temporary logging in the overlay and provider (e.g. in `close()` worklet and in `open()` / `openToCenter`) to confirm: (1) tap path runs `close()` and (2) on second open, expand animation (or `openToCenter`) actually runs and updates the shared values.
- Try a single "request close" entry point that always runs the same close worklet on the UI thread (tap, close button, and pan all go through it) and ensure no other code path sets `imageState` or clears `activeUrl` before the animation completes.
- Try reversing gesture order to `Gesture.Exclusive(tapBackdrop, pan)` to see if tap consistently wins after a prior pan.

---

**Use this text to open a new GitHub issue:** copy the contents of this file into the issue body and set the title to:  
`Image overlay: tap-to-close animation doesn't run after a prior drag-to-close`.
