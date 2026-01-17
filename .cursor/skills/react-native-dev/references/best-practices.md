# Best Practices

> Reference for: React Native Expert
> Load when: Performance optimization, debugging, development workflow

## Table of Contents
- [Performance Best Practices](#performance-best-practices) - Frame rate, testing, animations
- [Memory Management](#memory-management) - Cleanup, common leaks
- [Code Quality](#code-quality) - Styles, dimensions, TypeScript
- [Development Workflow](#development-workflow) - Pre-commit checklist, testing, pitfalls

## Performance Best Practices

### Frame Rate Targets

- **Target**: 60 FPS (16.67ms per frame)
- Monitor both JS thread and UI thread frame rates
- Use dev menu: `Show Perf Monitor`

### Critical Rules

**1. Test in Release Mode**
```bash
# Development mode has ~2-5x slower JS performance
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

**2. Remove console.log in Production**

Console statements cause massive bottlenecks. Remove them with Babel:

```json
// babel.config.js
{
  "env": {
    "production": {
      "plugins": ["transform-remove-console"]
    }
  }
}
```

```bash
npm i babel-plugin-transform-remove-console --save-dev
```

**3. Optimize List Rendering**

```typescript
// Use getItemLayout for fixed-height items
const getItemLayout = (_, index) => ({
  length: ITEM_HEIGHT,
  offset: ITEM_HEIGHT * index,
  index,
});

// Or use FlashList for large lists
import { FlashList } from '@shopify/flash-list';
```

**4. Use Native Driver for Animations**

```typescript
// Forces animation to run on UI thread
Animated.timing(animatedValue, {
  toValue: 1,
  duration: 300,
  useNativeDriver: true, // Required!
}).start();
```

**5. Defer Heavy Work During Interactions**

```typescript
import { InteractionManager } from 'react-native';

function handlePress() {
  requestAnimationFrame(() => {
    InteractionManager.runAfterInteractions(() => {
      // Heavy work here
      processData();
    });
  });
}
```

**6. Optimize Image Animations**

```typescript
// ❌ Bad - re-crops image every frame
<Animated.Image style={{ width: animatedValue, height: animatedValue }} />

// ✅ Good - uses transform
<Animated.Image style={{ transform: [{ scale: animatedValue }] }} />
```

**7. Hardware Acceleration (Use Carefully)**

```typescript
// Android: Enable for moving views over images
<View style={{ renderToHardwareTextureAndroid: true }}>
  <Image />
  <View style={{ opacity: 0.5 }} />
</View>

// iOS: Enabled by default with shouldRasterizeIOS
```

⚠️ **Warning**: Monitor memory usage. Disable when animation completes.

## Memory Management

```typescript
useEffect(() => {
  // Setup subscription
  const subscription = eventEmitter.addListener('event', handler);

  // ALWAYS cleanup
  return () => subscription.remove();
}, []);
```

**Common memory leaks:**
- EventEmitter subscriptions
- Timers (setTimeout, setInterval)
- Animated listeners
- Network requests

## Code Quality

### StyleSheet.create vs Inline Styles

```typescript
// ❌ Bad - creates new object every render
<View style={{ padding: 16, backgroundColor: '#fff' }} />

// ✅ Good - reuses same object
const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#fff' },
});
<View style={styles.container} />
```

### Avoid Hardcoded Dimensions

```typescript
// ❌ Bad
<View style={{ width: 375, height: 812 }} />

// ✅ Good - responsive
<View style={{ width: '100%', aspectRatio: 16/9 }} />

// Or use flex
<View style={{ flex: 1 }} />
```

### TypeScript Types

```typescript
// Define prop types
interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}

// Use typed hooks
const [count, setCount] = useState<number>(0);
const params = useLocalSearchParams<{ id: string }>();
```

## Development Workflow

### Pre-commit Checklist

- [ ] Remove all `console.log` statements
- [ ] Test on both iOS and Android
- [ ] Test on real devices (not just simulator)
- [ ] Check for memory leaks
- [ ] Verify animations run at 60 FPS
- [ ] Test with slow network conditions
- [ ] Verify keyboard handling works

### Testing Performance

```bash
# iOS
npx expo run:ios --configuration Release

# Android
npx expo run:android --variant release

# Then use Perf Monitor from dev menu
```

### Common Pitfalls to Avoid

| Issue | Problem | Solution |
|-------|---------|----------|
| Development mode testing | JS thread 2-5x slower | Test in release mode |
| Console logs | Massive bottleneck | Remove in production |
| ScrollView for lists | Poor performance | Use FlatList |
| Inline styles | New object every render | Use StyleSheet.create |
| No useNativeDriver | Animations on JS thread | Add useNativeDriver: true |
| Unhandled subscriptions | Memory leaks | Cleanup in useEffect return |

## Quick Performance Checklist

✅ **Do:**
- Test in release mode
- Use FlatList for lists >50 items
- Memoize list items
- Use native driver for animations
- Defer heavy work with InteractionManager
- Clean up subscriptions

❌ **Don't:**
- Leave console.log in production
- Use ScrollView for large lists
- Use inline styles
- Ignore memory leaks
- Test only in development mode
- Hardcode dimensions
