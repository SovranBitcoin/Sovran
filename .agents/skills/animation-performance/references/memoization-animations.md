# Memoize Animations

Every time your component re-renders, any animations you create inside the render function are recreated. This wastes memory and processing time.

**Don't do this** – creating a new animation object on every render:

```tsx
{
  items.map((item) => <Animated.View entering={FadeIn.duration(300)} key={item.id} />);
}
```

**Instead**, create the animation once outside the component or memoize it:

```tsx
const fadeIn = FadeIn.duration(300);
{
  items.map((item) => <Animated.View entering={fadeIn} key={item.id} />);
}
```

By storing the animation in a constant, you create it once and reuse the same object for all items. This reduces memory allocation and garbage collection, keeping your animations smooth even with long lists.
