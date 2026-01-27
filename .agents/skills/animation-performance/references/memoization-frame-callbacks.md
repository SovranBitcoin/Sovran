# Memoize Frame Callbacks

If you are using `useFrameCallback`, you should wrap the frame callback worklet inside `useCallback` in order to memoize it. This way, the frame callback won't need to be recreated and thus registered on every render. If you are using React Compiler, the frame callback should be memoized automatically.

```tsx
useFrameCallback(
  useCallback(() => {
    "worklet";
    // your frame callback logic here
  }, [...deps])
);
```
