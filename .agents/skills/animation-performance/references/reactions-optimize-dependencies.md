# Optimize useAnimatedReaction

Avoid unnecessary `useAnimatedReaction` hooks and ensure they only react to values that actually need side effects. Each reaction runs on every change of the tracked value, so unnecessary reactions can impact performance.

**Don't do this** – reacting to values that don't need side effects:

```tsx
// ❌ Reacting to every scroll position change when you only need to react at thresholds
useAnimatedReaction(
  () => scrollOffset.get(),
  (current) => {
    scheduleOnRN(updateHeader); // Called on every scroll frame
  }
);
```

**Instead**, use `useDerivedValue` with conditional logic or only react when values cross thresholds:

```tsx
// ✅ Only react when crossing a threshold
const hasScrolledPastThreshold = useDerivedValue(() => {
  return scrollOffset.get() > 100;
});

useAnimatedReaction(
  () => hasScrolledPastThreshold.get(),
  (current, previous) => {
    // Only react when the value changes (crosses threshold)
    if (current !== previous) {
      scheduleOnRN(updateHeader);
    }
  }
);
```

**Best practices:**

1. **Only react when you need side effects** – Use `useDerivedValue` for computed values that don't need side effects
2. **Use proper dependency tracking** – Ensure the reaction only tracks values that actually matter
3. **Avoid reacting to frequently changing values** – If a value changes every frame, consider using `useDerivedValue` instead
4. **Batch side effects** – If multiple reactions trigger the same side effect, combine them

**Example – combining multiple reactions:**

```tsx
// ❌ Multiple reactions for related values
useAnimatedReaction(() => scale.get(), (current) => scheduleOnRN(updateState));
useAnimatedReaction(() => opacity.get(), (current) => scheduleOnRN(updateState));

// ✅ Single reaction tracking combined state
const animationState = useDerivedValue(() => ({
  scale: scale.get(),
  opacity: opacity.get(),
}));

useAnimatedReaction(
  () => animationState.get(),
  (current) => {
    scheduleOnRN(updateState);
  }
);
```
