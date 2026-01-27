# Avoid Conditional Logic in Worklets

Minimize conditional logic inside `useAnimatedStyle` and other worklets. Conditionals run every frame, which can cause performance issues if the conditional logic is expensive or frequently evaluated.

**Don't do this** – expensive conditional logic running every frame:

```tsx
const animatedStyle = useAnimatedStyle(() => {
  // ❌ This conditional runs every frame
  if (offset.get() > 100) {
    return { opacity: 0.5, transform: [{ scale: 1.2 }] };
  } else {
    return { opacity: 1, transform: [{ scale: 1 }] };
  }
});
```

**Instead**, use `useDerivedValue` to compute conditional values only when dependencies change:

```tsx
const opacity = useDerivedValue(() => {
  return offset.get() > 100 ? 0.5 : 1;
});

const scale = useDerivedValue(() => {
  return offset.get() > 100 ? 1.2 : 1;
});

const animatedStyle = useAnimatedStyle(() => {
  return {
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  };
});
```

Now the conditional logic only runs when `offset.value` changes, not on every frame. The `useAnimatedStyle` just reads the pre-computed values, which is much faster.

For simple conditionals that don't require complex calculations, you can also use ternary operators directly in `useDerivedValue`:

```tsx
const animatedStyle = useAnimatedStyle(() => ({
  opacity: offset.get() > 100 ? 0.5 : 1, // ✅ Simple ternary is okay
}));
```
