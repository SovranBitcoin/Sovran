# Version Management

> Reference for: React Native Expert
> Load when: Installing dependencies, version conflicts, SDK upgrades

## Version Compatibility Chart

| Expo SDK | React Native | React | React Native Web | Node.js |
|----------|--------------|-------|------------------|---------|
| 54.0.0 | 0.81 | 19.1.0 | 0.21.0 | 20.19.x |
| 53.0.0 | 0.79 | 19.0.0 | 0.20.0 | 20.18.x |
| 52.0.0 | 0.76 | 18.3.1 | 0.19.13 | 20.18.x |

**Important**: Expo SDK releases target a single React Native version. Packages may not work with older RN versions.

## Installing Third-Party Libraries

**ALWAYS use `expo install` instead of `npm install` or `yarn add`:**

```bash
# Correct - automatically picks compatible version
npx expo install @react-navigation/native

# Wrong - may install incompatible version
npm install @react-navigation/native
```

**Why `expo install` is required:**
- Automatically selects compatible package versions
- Warns about known incompatibilities
- Prevents version conflicts with Expo SDK

## Common Installation Patterns

```bash
# Single package
npx expo install react-native-reanimated

# Multiple packages
npx expo install react-native-gesture-handler react-native-screens

# Specific packages with dependencies
npx expo install @react-navigation/native @react-navigation/native-stack
```

## Upgrading Expo SDK

```bash
# Upgrade to latest SDK
npx expo upgrade

# Upgrade to specific SDK version
npx expo upgrade 54.0.0
```

The upgrade command automatically updates dependencies to compatible versions.

## Version Compatibility Rules

1. **Expo SDK → React Native**: One-to-one mapping (non-negotiable)
2. **Third-party libs**: Must be compatible with your RN version
3. **Node.js**: Use the version specified for your Expo SDK
4. **Release cadence**: Expo releases 3x per year

## Troubleshooting Version Conflicts

```bash
# Check current versions
npx expo-doctor

# Fix common issues
npx expo install --fix
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npx expo install <pkg>` | Install compatible package |
| `npx expo upgrade` | Upgrade Expo SDK |
| `npx expo-doctor` | Check for issues |
| `npx expo install --fix` | Fix version conflicts |
