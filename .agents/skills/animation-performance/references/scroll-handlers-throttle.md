# Optimize Scroll Handlers for Animated Lists

If you use animated lists with Reanimated `scrollHandler`, use `scrollEventThrottle={16}` to limit how often scroll events will be fired while scrolling. The value `16` corresponds to 60fps (16ms per frame). This may be useful when expensive work is performed in response to scrolling. Values <= 16 will disable throttling, regardless of the refresh rate of the device.

```tsx
<Animated.FlatList
  onScroll={scrollHandler}
  scrollEventThrottle={16}
  // ... other props
/>
```

This ensures scroll events are fired at a consistent rate, preventing performance issues when handling scroll events with Reanimated worklets.
