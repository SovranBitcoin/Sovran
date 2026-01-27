# Memoize Gesture Objects

If you are using React Native Gesture Handler, you should wrap gesture objects like `Gesture.Tap()` or similar inside `useMemo` in order to memoize them. This way, the gestures won't need to be reattached on every render. This is particularly important for FlatList items where performance is key. If you are using React Compiler, the gesture objects should be memoized automatically.

```tsx
const pan = useMemo(
  () =>
    Gesture.Pan()
      .onStart(() => {})
      .onEnd(() => {}),
  [...deps]
);
```
