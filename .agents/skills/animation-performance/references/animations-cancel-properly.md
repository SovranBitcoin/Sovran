# Cancel Animations Properly

Cancel running animations before starting new ones to prevent memory leaks, conflicting animations, and performance issues. Use `cancelAnimation` to stop animations cleanly.

**Don't do this** – starting new animations without canceling previous ones:

```tsx
const handlePress = () => {
  // ❌ Previous animation continues running, causing conflicts
  scale.set(withSpring(1.2));
};

const handlePressAgain = () => {
  // ❌ Another animation starts while the previous one is still running
  scale.set(withSpring(0.8));
};
```

**Instead**, cancel the animation before starting a new one:

```tsx
import { cancelAnimation } from "react-native-reanimated";

const handlePress = () => {
  cancelAnimation(scale); // ✅ Cancel any running animation
  scale.set(withSpring(1.2));
};

const handlePressAgain = () => {
  cancelAnimation(scale); // ✅ Cancel before starting new animation
  scale.set(withSpring(0.8));
};
```

**When to cancel animations:**

1. **Before starting new animations** – Always cancel before setting a new animation value
2. **On component unmount** – Cancel animations in cleanup to prevent memory leaks
3. **On gesture start** – Cancel animations when gestures begin to avoid conflicts
4. **On state changes** – Cancel when state changes that should interrupt animations

**Example with cleanup:**

```tsx
useEffect(() => {
  return () => {
    // ✅ Cancel animations on unmount
    cancelAnimation(scale);
    cancelAnimation(opacity);
    cancelAnimation(translateX);
  };
}, []);
```

**Example with gesture handlers:**

```tsx
const pan = useMemo(
  () =>
    Gesture.Pan()
      .onStart(() => {
        // ✅ Cancel animations when gesture starts
        cancelAnimation(translateX);
        cancelAnimation(translateY);
      })
      .onUpdate((event) => {
        translateX.set(event.translationX);
        translateY.set(event.translationY);
      }),
  []
);
```

**Canceling multiple shared values:**

```tsx
const cancelAllAnimations = useCallback(() => {
  cancelAnimation(scale);
  cancelAnimation(opacity);
  cancelAnimation(translateX);
  cancelAnimation(translateY);
}, []);

// Use before starting new animations
const resetAnimations = () => {
  cancelAllAnimations();
  scale.set(1);
  opacity.set(1);
  translateX.set(0);
  translateY.set(0);
};
```
