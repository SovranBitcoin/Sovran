# Batch Updates

When you update multiple shared values, each update can trigger a separate re-render. This creates unnecessary work for the UI thread.

**Don't do this** – triggering multiple re-renders:

```tsx
scale.set(withSpring(1.2));
opacity.set(withSpring(0.8));
```

**Instead**, batch the updates using `scheduleOnUI` (react-native-worklets). Define the function outside using `useCallback` and pass the function reference:

```tsx
const batchUpdates = useCallback(() => {
  scale.set(withSpring(1.2));
  opacity.set(withSpring(0.8));
}, []);

scheduleOnUI(batchUpdates);
```

The `scheduleOnUI` function ensures both updates happen in the same frame, so the UI only re-renders once. This is especially important when updating many values at once, like in complex gestures or choreographed animations.
