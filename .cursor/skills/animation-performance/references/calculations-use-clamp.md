# Use clamp Instead of Manual Math.min/max

Use the `clamp` function from `react-native-reanimated` instead of manual `Math.min`/`Math.max` operations in worklets. The `clamp` function is optimized for worklets and provides better performance in performance-critical paths.

**Don't do this** – manual clamping with Math.min/max:

```tsx
const animatedStyle = useAnimatedStyle(() => {
  // ❌ Manual clamping - less efficient in worklets
  const clampedValue = Math.min(Math.max(offset.get(), 0), 100);
  return { width: clampedValue };
});
```

**Instead**, use `clamp` from `react-native-reanimated`:

```tsx
import { clamp } from "react-native-reanimated";

const animatedStyle = useAnimatedStyle(() => {
  // ✅ Using clamp - optimized for worklets
  const clampedValue = clamp(offset.get(), 0, 100);
  return { width: clampedValue };
});
```

**Note:** You must import `clamp` from `react-native-reanimated`. It's a worklet-optimized function that performs better than manual `Math.min`/`Math.max` operations.

**Usage:**

```tsx
import { clamp } from "react-native-reanimated";

// Syntax: clamp(value, min, max)
const clampedValue = clamp(inputValue.get(), 0, 100);
```

**Example with useDerivedValue:**

```tsx
import { clamp } from "react-native-reanimated";

const clampedOffset = useDerivedValue(() => {
  return clamp(offset.get(), 0, screenWidth);
});

const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ translateX: clampedOffset.get() }],
}));
```

**Benefits:**

- More efficient in worklets than `Math.min`/`Math.max`
- Cleaner, more readable code
- Optimized for performance-critical animation paths
- Works seamlessly with shared values and derived values
