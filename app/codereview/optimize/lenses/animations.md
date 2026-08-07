# Lens: animations (Reanimated 4 thread hygiene + animation quality)

Scope: anywhere `react-native-reanimated`, `react-native-worklets`, gesture
handlers, or `@gorhom/bottom-sheet` animate. Two halves: does it *perform*,
and does it *feel right*.

## Thread hygiene (perf)

- **JS-thread reads of shared values are the #1 killer.** Every
  `sharedValue.value` read on the JS thread triggers a synchronous UI-runtime
  round-trip (`executeOnUIRuntimeSync`) — documented +500ms initial-render
  cases. Detect: `.value` in `useEffect`/`useMemo`/`useCallback` dep arrays,
  `useState(sv.value)`, `useSharedValue(otherSv.value)`, `sv.value` passed as
  a prop (e.g. `initialPage={index.value}`). Fix shape:
  `useAnimatedReaction` + `runOnJS`/`scheduleOnRN`.
- `runOnJS` inside `useAnimatedStyle`/`useDerivedValue` can fire per frame and
  flood the JS thread. Move to gesture-end / `withTiming` completion.
- `setState` in `onUpdate`/scroll/`onChange`/`onAnimate` callbacks = re-render
  per frame. Detect: `set[A-Z]` inside gesture/sheet/scroll callbacks. Scroll
  UI belongs in `useAnimatedScrollHandler` + shared values.
- Animating layout props (`width`/`height`/`top`/`margin`) forces layout per
  frame — prefer transform/opacity. Detect: layout props in `useAnimatedStyle`
  return objects or `withTiming` targets. Also flags into content-shift lens
  when siblings move.
- `entering=`/`exiting=` layout animations on list items are CPU-heavy at
  scale. Flag on feed rows.
- Heavy computation inside `'worklet'` bodies blocks the UI thread (worse than
  blocking JS). Detect: loops/parsing in worklets.
- `useAnimatedStyle` result on a plain `View` (not `Animated.View`) silently
  degrades. Detect statically.

## Bottom-sheet specifics

- `{isOpen && <Content/>}` keyed to snap state remounts per snap — keep
  mounted, drive opacity/`pointerEvents` from `animatedIndex`.
- Scrollables inside sheets must be the `BottomSheet*` variants
  (`BottomSheetScrollView`/`BottomSheetFlatList`/`BottomSheetTextInput`).
- Known snap-point/dynamic-sizing re-measures: pass explicit snap points or
  `enableDynamicSizing={false}` when content height is known.

## Animation quality (feel)

- Duration norms (NN/g): ~100ms micro-feedback, 200–300ms modals/screen
  transitions, ≤400ms large moves; >500ms on a routine transition is a defect.
  Exits slightly shorter than entrances. Detect: `withTiming(..., {duration:`
  literals >400 on frequent paths; frequently-seen animations should be the
  *subtlest*.
- Never linear easing for spatial motion — ease-out in, ease-in out; springs
  for gesture-driven motion. Detect: `Easing.linear` on translations.
- **Interruptibility**: gesture-driven UI must retarget mid-flight. Detect:
  `isAnimating` boolean guards that swallow input until a completion callback,
  `pointerEvents="none"` for an animation's duration, fire-and-forget timing
  chains where a spring on the live shared value belongs.
- **Reduced motion**: Reanimated defaults to `ReduceMotion.System` — flag
  explicit `ReduceMotion.Never` without justification; decorative loops
  (shimmer, pulse) should check `useReducedMotion`. Critically: under reduced
  motion, exiting animations are omitted and completion callbacks may not fire
  — completion *logic* (state transitions, navigation) must not live only in
  animation callbacks. Cross-check with the state-machines lens.

## Evidence

```bash
rg -n "\.value" features shared --type tsx | rg "useEffect|useMemo|useCallback|useState"
rg -n "runOnJS|scheduleOnRN" features shared          # then check enclosing worklet
rg -n "withTiming\(.*duration" features shared
rg -n "Easing\.linear|ReduceMotion\.Never" features shared
rg -n "entering=|exiting=" features/feed features/transactions
npx tsx codereview/log-doctor/index.ts perf --latest
npx tsx codereview/log-doctor/index.ts slow --latest --threshold 200
```

## Do not flag

- Skia-driven scenes (different pipeline; judge separately only with runtime
  evidence).
- One-shot onboarding/celebration animations for duration-norm violations.
