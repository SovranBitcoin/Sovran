# Setup Guide

> Reference for: React Native Expert
> Load when: Initializing new project, project setup, Expo Go vs Development Build

## Table of Contents
- [Creating a New Expo Project](#creating-a-new-expo-project) - Initialization commands and templates
- [Development Environment](#development-environment-expo-go-vs-development-builds) - Expo Go vs Development Builds
- [Post-Setup Configuration](#post-setup-configuration) - TypeScript, dependencies, Babel
- [Quick Reference](#quick-reference) - Command summary

## Creating a New Expo Project

### Prerequisites

```bash
# Check Node.js (LTS required)
node --version

# Should be 20.18.x or later for latest Expo SDK
```

### Initialize Project

```bash
# Create new Expo project
npx create-expo-app@latest my-app

# With TypeScript template (recommended)
npx create-expo-app@latest my-app --template

# Navigate to project
cd my-app

# Start development server
npx expo start
```

### Project Templates

```bash
# Blank template (minimal)
npx create-expo-app@latest --template blank

# Blank with TypeScript
npx create-expo-app@latest --template blank-typescript

# Tabs template (with navigation)
npx create-expo-app@latest --template tabs
```

## Development Environment: Expo Go vs Development Builds

### Expo Go

**What it is**: Pre-built sandbox app from app stores

**Use for:**
- Quick prototyping
- Learning Expo
- Testing JavaScript-only changes
- Short-term experiments

**Limitations:**
- NO custom native modules
- Only includes pre-bundled libraries
- Single SDK version support
- Cannot test custom app icons, splash screens, or native configs

**Install:**
```bash
# iOS
Download from App Store

# Android
Download from Google Play Store
```

### Development Builds

**What it is**: Custom build of YOUR app with dev tools

**Use for:**
- Production projects
- Custom native modules (firebase, camera, etc.)
- Testing native features (push notifications, deep links)
- Custom app configuration (icons, splash, native code)

**Create a development build:**
```bash
# Install expo-dev-client
npx expo install expo-dev-client

# Build for iOS simulator
npx expo run:ios

# Build for Android emulator
npx expo run:android

# Or use EAS Build for physical devices
eas build --profile development --platform ios
```

**When to switch from Expo Go → Development Build:**
1. Need native modules not in Expo Go
2. Moving toward production
3. Need push notifications
4. Need app/universal links
5. Testing custom native assets

## Post-Setup Configuration

### TypeScript (if not using template)

```bash
# Initialize TypeScript
npx expo install typescript @types/react @types/react-native

# Create tsconfig.json
npx expo start
```

### Essential Dependencies

```bash
# Navigation (most projects need this)
npx expo install expo-router react-native-safe-area-context react-native-screens

# State management
npx expo install zustand @tanstack/react-query

# Fast storage
npx expo install react-native-mmkv

# Animations
npx expo install react-native-reanimated react-native-gesture-handler
```

### Configure Babel (for path aliases)

```javascript
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@': '.',
            '@/components': './components',
            '@/hooks': './hooks',
          },
        },
      ],
      'react-native-reanimated/plugin', // MUST be last
    ],
  };
};
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npx create-expo-app@latest` | Create new project |
| `npx expo start` | Start dev server |
| `npx expo run:ios` | Build for iOS |
| `npx expo run:android` | Build for Android |
| `npx expo install <pkg>` | Install compatible package |
| `npx expo-doctor` | Check project health |

| Environment | Use Case |
|-------------|----------|
| Expo Go | Quick testing, learning |
| Development Build | Production apps, native modules |
