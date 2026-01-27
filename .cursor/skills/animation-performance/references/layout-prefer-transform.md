# Prefer Transform Over Layout

Animating non-layout properties (like `transform`, `opacity`, or `backgroundColor`) is generally more performant than animating styles that affect layout (like `top`/`left`, `width`/`height`, `margin`, or `padding`). That's because the latter group requires an additional step of layout recalculation on each animation frame.

Animating layout properties like `width`, `height`, `margin`, or `padding` forces React Native to recalculate the position of every element that depends on the changing element. This is expensive.

**Don't do this** – expensive layout recalculation:

```tsx
width: withSpring(newWidth);
top: withSpring(newTop);
```

**Instead**, use transform properties and other non-layout styles, which only affect the visual appearance without triggering layout:

```tsx
transform: [{ translateX: withSpring(offsetX), translateY: withSpring(offsetY) }];
opacity: withSpring(0.5);
backgroundColor: withSpring("rgba(255, 0, 0, 0.5)");
```

Transform operations are hardware-accelerated and don't affect layout, making them dramatically faster. Whenever possible, use `translateX/Y` instead of changing `top`/`left`, `scale` instead of changing `width`/`height`, and `rotate` instead of changing orientation.
