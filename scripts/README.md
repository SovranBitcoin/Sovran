# Code Analysis Scripts

This directory contains scripts to help maintain code quality and find unused code in your project.

## Find Unused Code

### 🚀 Quick Usage

```bash
# Comprehensive analysis (recommended)
yarn find-unused

# Fast basic analysis
yarn find-unused:simple
```

### 📋 Scripts Available

#### 1. `find-unused.js` - Comprehensive Analysis

A thorough Node.js script that analyzes your TypeScript/JavaScript codebase to find:

- **Unused Exports** - Functions, constants, types exported but never imported
- **Unused Functions** - Internal functions that are declared but never called
- **Unused Constants** - Constants declared but never referenced
- **Unused Variables** - Variables declared but never used
- **Unused Types** - Interfaces, types, enums that are declared but never used

**Features:**

- ✅ Handles TypeScript and JavaScript files
- ✅ Understands React/React Native patterns
- ✅ Respects entry points (won't flag \_layout.tsx, index files, etc.)
- ✅ Analyzes import/export relationships
- ✅ Provides detailed file locations and line numbers

**Usage:**

```bash
node scripts/find-unused.js
# or
yarn find-unused
```

#### 2. `find-unused-simple.sh` - Fast Basic Analysis

A shell script using `grep` for quick analysis. Faster but less accurate than the Node.js version.

**Usage:**

```bash
./scripts/find-unused-simple.sh
# or
yarn find-unused:simple
```

### 📁 What Gets Analyzed

The scripts scan these directories:

- `app/` - Your main application code
- `components/` - React components
- `helper/` - Utility functions and helpers
- `hooks/` - Custom React hooks
- `hocs/` - Higher-order components

**File types analyzed:**

- `.ts` - TypeScript files
- `.tsx` - TypeScript React files
- `.js` - JavaScript files
- `.jsx` - JavaScript React files

### 🚫 What Gets Ignored

- `node_modules/`
- Test files (`.test.`, `.spec.`)
- Story files (`.stories.`)
- Type definition files (`.d.ts`)
- Build directories

### ⚠️ Important Notes

1. **Review Before Deleting**: These scripts provide suggestions, but you should carefully review each item before removing it.

2. **False Positives**: The scripts might flag code that is:
   - Used in configuration files
   - Called dynamically (e.g., `window[functionName]()`)
   - Used in JSX props as strings
   - Required by external libraries

3. **Entry Points**: Files like `_layout.tsx`, `index.tsx`, and `global.ts` are treated as entry points and their exports won't be flagged as unused.

4. **React Components**: The script understands that default exports in React components are typically used in routing or parent components.

### 📊 Example Output

```
🔍 Scanning for unused code...

📁 Found 156 files to analyze
📤 Found 89 exports
📋 Found 234 declarations
🔗 Found 67 names with usages

📊 UNUSED CODE REPORT
==================================================

Unused Exports (3):
------------------
  • calculateOldFee (helper/calculations.ts:45)
  • formatLegacyAddress (helper/bitcoin.ts:123)
  • validateEmail (helper/validation.ts:67)

Unused Functions (5):
--------------------
  • debugLog (helper/debug.ts:12)
  • parseOldFormat (helper/parsing.ts:89)

📈 SUMMARY
------------------------------
Total unused items found: 8
Files analyzed: 156
```

### 🛠 Customization

You can modify the configuration in `find-unused.js`:

```javascript
const config = {
  // Add more directories to scan
  scanDirs: ['app', 'components', 'helper', 'hooks', 'hocs', 'lib'],

  // Add more file extensions
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],

  // Add patterns to ignore
  ignorePatterns: [/node_modules/, /\.d\.ts$/, /custom-pattern/],
};
```

### 💡 Best Practices

1. **Run Regularly**: Include unused code analysis in your development workflow
2. **Before Refactoring**: Run before major refactors to clean up first
3. **Code Reviews**: Use as part of code review process
4. **CI/CD**: Consider adding to your CI pipeline to catch unused code early

### 🔧 Troubleshooting

If the scripts don't work:

1. **Permissions**: Make sure the shell script is executable:

   ```bash
   chmod +x scripts/find-unused-simple.sh
   ```

2. **Node.js**: Ensure you have Node.js installed for the comprehensive script

3. **Dependencies**: The scripts don't require additional npm packages, they use Node.js built-ins

### 📈 Performance

- **Comprehensive script**: ~5-10 seconds for medium projects (100-200 files)
- **Simple script**: ~1-3 seconds for quick analysis

Choose the comprehensive script for accuracy, or the simple script for speed during development.
