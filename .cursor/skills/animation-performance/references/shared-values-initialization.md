# Avoid Expensive Shared Value Initialization

Initialize shared values with simple, primitive values. Avoid expensive computations or function calls during initialization. Compute complex initial values in worklets or `useEffect` instead.

**Don't do this** – expensive initialization:

```tsx
// ❌ Expensive computation during initialization
const complexValue = useSharedValue(
  calculateComplexValue(props.data) // Expensive operation runs on every render
);

// ❌ Function call that might be expensive
const measuredValue = useSharedValue(
  measureComponent() // Might cause layout calculations
);
```

**Instead**, initialize with simple values and compute complex ones in worklets or effects:

```tsx
// ✅ Initialize with simple value
const complexValue = useSharedValue(0);

useEffect(() => {
  // ✅ Compute expensive value in useEffect (runs once)
  const initialValue = calculateComplexValue(props.data);
  complexValue.set(initialValue);
}, [props.data]);

// ✅ Or compute in worklet when needed
const computedValue = useDerivedValue(() => {
  return calculateComplexValue(props.data);
});
```

**Best practices:**

1. **Use primitive values** – Initialize with numbers, booleans, or simple objects
2. **Compute in effects** – Use `useEffect` for one-time expensive computations
3. **Use derived values** – Use `useDerivedValue` for values that depend on other shared values
4. **Lazy initialization** – Compute values only when they're actually needed

**Example – measuring layout:**

```tsx
// ❌ Trying to measure during initialization
const measuredWidth = useSharedValue(measureView()); // Won't work - view not mounted

// ✅ Initialize with default, measure after mount
const measuredWidth = useSharedValue(0);

const onLayout = useCallback((event: LayoutChangeEvent) => {
  measuredWidth.set(event.nativeEvent.layout.width);
}, []);
```

**Example – complex initial state:**

```tsx
// ❌ Complex object creation during initialization
const state = useSharedValue({
  items: processLargeArray(data), // Expensive operation
  metadata: computeMetadata(data),
});

// ✅ Initialize with simple structure, populate in effect
const state = useSharedValue({ items: [], metadata: {} });

useEffect(() => {
  state.set({
    items: processLargeArray(data),
    metadata: computeMetadata(data),
  });
}, [data]);
```

**Example – derived from props:**

```tsx
// ❌ Recomputing on every render
const Component = ({ items }) => {
  const filteredItems = useSharedValue(
    items.filter((item) => item.active) // Runs on every render
  );
};

// ✅ Use derived value or memoize
const Component = ({ items }) => {
  const filteredItems = useDerivedValue(() => {
    return items.filter((item) => item.active); // Only recomputes when items change
  });
};
```
