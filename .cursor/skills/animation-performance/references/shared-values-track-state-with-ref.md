# Track Animation State with useRef Instead of Reading Shared Values

When you need to track animation state (like toggle state) to determine the next animation target, use `useRef` instead of reading shared values on the JS thread. This avoids JS thread blocking and thread synchronization overhead.

## Problem

Reading shared values on the JS thread causes blocking:

```tsx
const animationProgress = useSharedValue(0);

const handlePress = () => {
  // ❌ Reading shared value on JS thread causes blocking
  const currentValue = animationProgress.get();
  const targetValue = currentValue === 0 ? 1 : 0;
  animationProgress.set(withSpring(targetValue));
};
```

**Issues:**
- JS thread blocks while synchronizing with UI thread
- Thread synchronization overhead on every read
- Can cause jank if UI thread is busy
- Multiple reads compound the performance impact

## Solution

Use `useRef` to track the animation state instead:

```tsx
const animationProgress = useSharedValue(0);
const isExpandedRef = useRef(false);

const handlePress = () => {
  // ✅ Use ref to track state - no JS thread blocking!
  const targetValue = isExpandedRef.current ? 0 : 1;
  isExpandedRef.current = !isExpandedRef.current;
  animationProgress.set(withSpring(targetValue));
};
```

**Benefits:**
- No JS thread blocking
- No thread synchronization overhead
- No re-renders (unlike `useState`)
- Instant state access
- Better performance, especially with rapid interactions

## When to Use This Pattern

Use `useRef` to track animation state when:

1. **Toggle animations** - Need to track whether animation is expanded/collapsed
2. **State-dependent animations** - Next animation depends on current state
3. **Rapid interactions** - User can trigger animations quickly
4. **Performance-critical** - Need to avoid any JS thread blocking

## Comparison with Alternatives

### ❌ Reading Shared Value on JS Thread

```tsx
const handlePress = () => {
  const current = progress.get(); // Blocks JS thread
  progress.set(withSpring(current === 0 ? 1 : 0));
};
```

**Problems:**
- JS thread blocking
- Thread synchronization overhead
- Can cause jank

### ❌ Using useState

```tsx
const [isExpanded, setIsExpanded] = useState(false);

const handlePress = () => {
  setIsExpanded(!isExpanded); // Triggers re-render
  progress.set(withSpring(isExpanded ? 0 : 1));
};
```

**Problems:**
- Triggers re-renders
- State updates are asynchronous
- Can cause timing issues

### ✅ Using useRef (Recommended)

```tsx
const isExpandedRef = useRef(false);

const handlePress = () => {
  const target = isExpandedRef.current ? 0 : 1;
  isExpandedRef.current = !isExpandedRef.current;
  progress.set(withSpring(target));
};
```

**Benefits:**
- No re-renders
- No JS thread blocking
- Synchronous state access
- Optimal performance

## Related Guidelines

- `shared-values-read-in-worklets.md` - General guideline about avoiding JS thread reads
- `re-renders-use-shared-values.md` - Why shared values don't cause re-renders
- `shared-values-during-render.md` - Don't read shared values during render

## Key Takeaway

**Use `useRef` to track animation state when you need to determine the next animation target. This avoids JS thread blocking while maintaining optimal performance without re-renders.**
