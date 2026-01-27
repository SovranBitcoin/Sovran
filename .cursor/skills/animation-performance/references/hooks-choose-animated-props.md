# useAnimatedProps vs useAnimatedStyle

Choose the right hook based on what you're animating. Use `useAnimatedProps` for non-style props (like `progress` in SVG components) and `useAnimatedStyle` for style properties. Using the wrong hook can cause unnecessary recalculations.

**When to use `useAnimatedStyle`:**

- Animating style properties (`transform`, `opacity`, `backgroundColor`, etc.)
- Most common use case for animating View components

```tsx
const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ scale: scale.get() }],
  opacity: opacity.get(),
}));

<Animated.View style={animatedStyle} />
```

**When to use `useAnimatedProps`:**

- Animating non-style props (e.g., `progress` in SVG, `value` in Slider)
- Props that don't affect style calculations
- Avoids unnecessary style recalculations

**Don't do this** – using `useAnimatedStyle` for non-style props:

```tsx
// ❌ Using useAnimatedStyle for SVG progress (not a style property)
const animatedStyle = useAnimatedStyle(() => ({
  progress: progressValue.get(), // This doesn't work - progress is not a style
}));

<Svg>
  <Circle animatedProps={animatedStyle} /> {/* Won't work */}
</Svg>
```

**Instead**, use `useAnimatedProps`:

```tsx
// ✅ Using useAnimatedProps for SVG progress
const animatedProps = useAnimatedProps(() => ({
  progress: progressValue.get(),
}));

<Svg>
  <Circle animatedProps={animatedProps} />
</Svg>
```

**Key differences:**

- `useAnimatedStyle` returns style objects and triggers style recalculations
- `useAnimatedProps` returns prop objects and doesn't trigger style recalculations
- Use `useAnimatedProps` when animating props that aren't styles to avoid unnecessary work

**Example with SVG:**

```tsx
import { Circle } from "react-native-svg";
import Animated, { useAnimatedProps } from "react-native-reanimated";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const Component = () => {
  const progress = useSharedValue(0);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: 100 - progress.get() * 100,
  }));

  return <AnimatedCircle animatedProps={animatedProps} />;
};
```
