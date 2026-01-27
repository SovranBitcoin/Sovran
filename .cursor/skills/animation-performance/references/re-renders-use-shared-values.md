# Avoid Unnecessary Re-renders

Use shared values instead of component state for animation-related values. Shared values update on the UI thread without triggering React re-renders, which improves performance.

**Don't do this** – using component state for animation values:

```tsx
const [scale, setScale] = useState(1);

// This triggers re-renders on every update
setScale(1.2);
```

**Instead**, use shared values:

```tsx
const scale = useSharedValue(1);

// This updates on the UI thread without re-renders
scale.set(withSpring(1.2));
```

It's okay to create animated contexts for components as long as they don't contain any state which can cause re-renders. Animated contexts that only provide shared values or animation configurations won't trigger unnecessary re-renders.
