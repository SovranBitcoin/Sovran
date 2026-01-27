# Don't Read or Modify Shared Values During Render

Don't read or modify the value of a shared value during a component's render. Access to `value` property or calling `get()`/`set()` methods is a side-effect. Triggering side-effects during render violates the Rules of React. All reads from and writes to a shared value should happen in relevant callbacks which aren't executed during render, i.e. in `useAnimatedStyle` or `useEffect` hooks.

**Don't do this** – accessing shared values during render:

```tsx
function Component() {
  const sv = useSharedValue(0);

  // ❌ Reading during render violates Rules of React
  const currentValue = sv.value;

  return <View />;
}
```

**Instead**, access shared values in appropriate hooks:

```tsx
function Component() {
  const sv = useSharedValue(0);

  // ✅ Reading in useAnimatedStyle is okay
  const animatedStyle = useAnimatedStyle(() => {
    return { opacity: sv.value };
  });

  // ✅ Reading in useEffect is okay
  useEffect(() => {
    console.log(sv.value);
  }, []);

  return <Animated.View style={animatedStyle} />;
}
```
