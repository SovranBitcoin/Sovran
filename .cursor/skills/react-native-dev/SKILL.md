---
name: react-native-dev
description: Expert for React Native and Expo mobile development. Use when working with React Native, Expo, mobile apps, iOS/Android platform-specific code, navigation (Expo Router, React Navigation, tabs, stacks, drawers), FlatList optimization, native modules, SafeAreaView, KeyboardAvoidingView, mobile performance optimization, storage (AsyncStorage, MMKV), setting up React Native/Expo projects, initializing new apps, version compatibility issues, installing dependencies with expo install, or performance best practices.
---

# React Native Development

Build production-ready cross-platform mobile applications with React Native and Expo.

## Reference Files

Load detailed guidance as needed:

| Topic | File | When to Load |
|-------|------|--------------|
| **Setup** | `references/setup-guide.md` | Creating new project, Expo Go vs Development Build |
| **Versions** | `references/version-management.md` | Installing dependencies, SDK upgrades, version conflicts |
| **Best Practices** | `references/best-practices.md` | Performance optimization, debugging, common pitfalls |
| Navigation | `references/expo-router.md` | Implementing Expo Router, tabs, stacks, deep linking |
| Platform Code | `references/platform-handling.md` | iOS/Android differences, SafeArea, keyboard, back button |
| List Performance | `references/list-optimization.md` | FlatList optimization, infinite scroll, pull-to-refresh |
| Storage | `references/storage-hooks.md` | AsyncStorage, MMKV, persistent state |
| Project Structure | `references/project-structure.md` | Project structure, configuration, dependencies |

## Key Principles

**Version Management:**
- ALWAYS use `npx expo install` instead of `npm install` or `yarn add`
- Expo SDK versions map one-to-one with React Native versions
- Check compatibility before upgrading dependencies

**Performance:**
- Use FlatList/SectionList for lists (never ScrollView for >50 items)
- Memoize list items with `memo()` and callbacks with `useCallback()`
- Use `getItemLayout` for fixed-height items
- Test performance in release mode, not development mode
- Remove console.log statements in production

**Platform Handling:**
- Use `Platform.select()` for platform-specific styles
- Use SafeAreaView or useSafeAreaInsets for notches
- Handle Android back button with BackHandler
- Use KeyboardAvoidingView with platform-specific behavior

**Code Quality:**
- TypeScript for all components
- Avoid inline styles (creates new objects on each render)
- Use flex layout instead of hardcoded dimensions
- Clean up subscriptions to prevent memory leaks
