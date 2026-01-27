# Avoid Reading Shared Values on the JS Thread

Reading shared values is allowed only from worklets running on the UI thread. You should avoid reading shared values in the React Native runtime on the JavaScript thread.

```tsx
const sv = useSharedValue(0);

useEffect(() => {
  console.log(sv.get()); // ❌ reading shared value in the RN runtime (not recommended)
}, []);

const animatedStyle = useAnimatedStyle(() => {
  return { opacity: sv.get() }; // ✅ this is okay
});
```

When you read the `sv.get()` in the React Native runtime, the JS thread will get blocked until the value is fetched from the UI thread. In most cases it will be negligible, but if the UI thread is busy or you are reading a value multiple times, the wait time needed to synchronize both threads may significantly increase.
