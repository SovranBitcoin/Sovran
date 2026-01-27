# Avoid Animating Too Many Components at Once

Reanimated is perfectly capable of animating several dozens of components at once. However, if there's too many components to be animated simultaneously, performance can be affected. As a rule of thumb, you should animate no more than 100 components for low-end Android devices and no more than 500 components for iOS. For more complex animations, consider using Reanimated with react-native-skia instead of rendering individual React components.

These optimizations will keep your animations buttery smooth. Now let's look at how to debug issues when they arise.
