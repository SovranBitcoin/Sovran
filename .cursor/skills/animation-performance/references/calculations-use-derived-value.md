# Optimize useAnimatedStyle Calculations

If you're doing expensive calculations inside `useAnimatedStyle`, those calculations run every frame, even if the dependencies haven't changed.

**Don't do this** – recalculating every frame:

```tsx
const animatedStyle = useAnimatedStyle(() => ({
  width: Math.min(Math.max(offset.get() * 2, 100), 500),
}));
```

**Instead**, use `useDerivedValue` to compute the value only when dependencies change:

```tsx
const width = useDerivedValue(() => Math.min(Math.max(offset.get() * 2, 100), 500));

const animatedStyle = useAnimatedStyle(() => ({
  width: width.get(),
}));
```

Now the complex calculation only runs when `offset.value` changes, not on every frame. The `useAnimatedStyle` just reads the pre-computed width, which is much faster.
