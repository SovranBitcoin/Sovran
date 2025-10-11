# JSDoc Standards for Sovran

## General JSDoc Rules

### 1. File Header Documentation

Every file should start with a comprehensive file header:

````typescript
/**
 * @fileoverview Brief description of the file's purpose
 *
 * @module path/to/module
 *
 * @description
 * **Detailed description of the file's functionality**
 * - Key feature 1
 * - Key feature 2
 * - Key feature 3
 *
 * **Usage:**
 * ```typescript
 * // Code example showing how to use this module
 * import { ComponentName } from './path';
 * ComponentName({ prop: 'value' });
 * ```
 *
 * @see {@link related-module}
 */
````

### 2. Component Documentation

All React components should have comprehensive JSDoc:

```typescript
/**
 * ComponentName - Brief description
 *
 * @component
 * @param {PropsType} props - Component props
 * @returns {JSX.Element}
 *
 * @example
 * <ComponentName prop1="value" prop2={123} />
 */
```

### 3. Function Documentation

All functions should have detailed JSDoc:

```typescript
/**
 * Function description
 *
 * @async
 * @description Detailed description of what the function does
 *
 * **Process:** step1 → step2 → step3
 * **Effects:** What side effects this function has
 *
 * @param {string} param1 - Description of param1
 * @param {number} [param2] - Optional parameter description
 * @returns {Promise<ReturnType>} Description of return value
 * @throws {Error} When this error occurs
 *
 * @example
 * const result = await functionName('value', 123);
 */
```

### 4. Utility Function Documentation

For utility functions, include comprehensive examples and edge cases:

```typescript
/**
 * Formats a number with appropriate suffixes (k, m, b) for large numbers
 *
 * This function converts large numbers into more readable format by adding
 * appropriate suffixes: 'k' for thousands, 'm' for millions, and 'b' for billions.
 * Numbers less than 1000 are returned as-is.
 *
 * @param num - The number to format (must be a positive number)
 * @returns A formatted string with appropriate suffix, removing trailing '.0' if present
 *
 * @example
 * formatNumber(1500) // '1.5k'
 * formatNumber(2500000) // '2.5m'
 * formatNumber(1000000000) // '1b'
 * formatNumber(500) // '500'
 * formatNumber(1000) // '1k' (removes trailing .0)
 */
```

### 5. Class Documentation

For classes, document the class purpose, methods, and usage patterns:

```typescript
/**
 * Generic device platform version checking with fluent API
 *
 * This class provides a chainable interface for checking device platform versions.
 * It supports iOS, Android, Web, Windows, and macOS platforms with various
 * comparison operators (gt, gte, lt, lte, eq).
 *
 * @example
 * // Basic usage
 * device.platform('ios').gte(10) // true if iOS 10 or higher
 * device.platform('android').lt(21) // true if Android below 5.0
 *
 * // Chaining
 * const isSupported = device.platform('ios').gte(12) || device.platform('android').gte(21);
 */
class DeviceChecker {
  /** The target platform OS being checked */
  private platformOS: string | null = null;
  /** The parsed version number of the current platform */
  private platformVersion: number | null = null;
}
```

### 6. Method Documentation

For class methods, include detailed parameter descriptions and return values:

```typescript
/**
 * Sets the target platform for version checking
 *
 * This method configures the checker to target a specific platform and
 * parses the current platform's version number. For iOS and Android,
 * the version is parsed as an integer, while other platforms use float parsing.
 *
 * @param platform - The target platform to check ('ios', 'android', 'web', 'windows', 'macos')
 * @returns The DeviceChecker instance for method chaining
 *
 * @example
 * device.platform('ios') // Configure to check iOS version
 * device.platform('android').gte(21) // Check if Android 5.0+
 */
platform(platform: 'ios' | 'android' | 'web' | 'windows' | 'macos'): DeviceChecker {
  // Implementation
}
```

### 7. Error Handling Documentation

For functions that handle errors, document error conditions and behavior:

```typescript
/**
 * Checks if a mint history entry has expired based on its payment request
 *
 * This function decodes the Lightning Network payment request from the history entry
 * and checks if the current time exceeds the expiry time. If no payment request
 * exists or decoding fails, it returns false (not expired).
 *
 * @param historyEntry - The mint history entry containing the payment request
 * @returns True if the entry has expired, false if not expired or if no payment request exists
 * @throws Will log an error to console if payment request decoding fails, but returns false
 *
 * @example
 * const entry = { paymentRequest: 'lnbc...', ... };
 * const isExpired = mintHistoryEntryExpired(entry);
 * if (isExpired) {
 *   // Handle expired entry - remove from UI or show warning
 * }
 */
```

## Sheet-Specific JSDoc Standards

### 1. Sheet Index Files

For main sheet index files (e.g., `mint-balance/index.tsx`):

````typescript
/**
 * @fileoverview SheetName Sheet - Brief description
 *
 * @module components/blocks/sheets/sheet-name
 *
 * @description
 * Multi-route sheet for [purpose]. Users can [action1], [action2], and [action3].
 *
 * **Routes:** 'route1' (initial), 'route2', 'route3'
 *
 * **Usage:**
 * ```typescript
 * // Open sheet
 * SheetManager.show('sheet-name', {
 *   payload: {
 *     prop1: 'value',
 *     prop2: 123,
 *     onAction: (result) => { /* handle result *\/ }
 *   }
 * });
 *
 * // Navigate (inside routes)
 * router?.navigate('route2');
 * router?.navigate('route3', { param: 'value' });
 *
 * // Close
 * SheetManager.hide('sheet-name');
 * ```
 *
 * @see {@link registerAllSheets}
 * @see {@link ./routes}
 */
````

### 2. Route Configuration Files

For route config files (e.g., `routes/index.tsx`):

```typescript
/**
 * @fileoverview Route config and types for SheetName
 *
 * @module components/blocks/sheets/sheet-name/routes
 *
 * @description
 * **Routes:**
 * - 'route1': Description of route1 functionality
 * - 'route2': Description of route2 functionality
 * - 'route3': Description of route3 functionality
 *
 * **Data:**
 * - Payload: `{prop1: string, prop2?: number}` - Sheet-wide, via `useSheetPayload()`
 * - Route Params: `{param: string}` - Passed via `router.navigate('route', {param})`
 * - Return: `{id: string, name: string}` - Via `await SheetManager.show()`
 *
 * **Flow:** route1 → user action → route2 → user action → close
 */
```

### 3. Route Component Files

For individual route components (e.g., `routes/routeName.tsx`):

```typescript
/**
 * @fileoverview RouteName - Brief description of route functionality
 *
 * @module components/blocks/sheets/sheet-name/routes/route-name
 *
 * @description
 * [Detailed description of what this route does]. Users can [action1], [action2], and [action3].
 *
 * **Navigation:**
 * - From: `router.navigate('route')` from [source route]
 * - To: `router.goBack()` or `router.navigate('nextRoute')`
 * - Close: `sheetRef.current?.hide({payload: result})`
 *
 * **Data:**
 * - Payload: `useSheetPayload('sheet-name')` - [Description of payload data]
 * - Params: `{param: string}` - Passed via `router.navigate('route', {param})`
 *
 * **Flow:** [Step 1] → [Step 2] → [Step 3] → [Result]
 *
 * @see {@link ./other-route}
 * @see {@link ./index}
 */
```

### 4. Sheet Component Functions

For functions within sheet components:

```typescript
/**
 * Handles [action description]
 *
 * @async
 * @description [Detailed description of what this function does]
 *
 * **Process:** [step1] → [step2] → [step3]
 * **Effects:** [Side effects, state changes, navigation, etc.]
 *
 * @param {string} param1 - [Description of parameter]
 * @param {Object} [options] - [Optional parameter description]
 * @param {boolean} [options.flag] - [Nested parameter description]
 * @returns {Promise<void>} [Description of return value]
 * @throws {Error} [When this error occurs]
 *
 * @example
 * await handleAction('value', { flag: true });
 */
```

### 5. Interface and Type Documentation

For interfaces and types:

```typescript
/**
 * Props for ComponentName
 *
 * @interface ComponentProps
 */
interface ComponentProps {
  /** Description of required prop */
  requiredProp: string;

  /** Description of optional prop */
  optionalProp?: number;

  /** Description of function prop */
  onAction: (result: ResultType) => void | Promise<void>;
}
```

## JSDoc Tags Reference

### Required Tags

- `@fileoverview` - Brief file description
- `@module` - Module path
- `@description` - Detailed description
- `@component` - For React components
- `@param` - For function parameters
- `@returns` - For return values

### Optional Tags

- `@async` - For async functions
- `@throws` - For functions that throw errors
- `@example` - Code examples
- `@see` - Related modules/functions
- `@deprecated` - For deprecated code
- `@todo` - For TODO items

### Sheet-Specific Tags

- `@navigation` - For route navigation patterns
- `@data` - For data flow documentation
- `@flow` - For user flow documentation
- `@process` - For function process steps
- `@effects` - For side effects

## Code Examples

### Complete Sheet Route Example

```typescript
/**
 * @fileoverview AddRoute - Discover and add new mints
 *
 * @module components/blocks/sheets/mint-balance/routes/add
 *
 * @description
 * Discovers available mints, allows custom URL entry, and adds selected mints to wallet.
 * Users can search discovered mints, add custom URLs, and select multiple mints for addition.
 *
 * **Navigation:**
 * - From: `router.navigate('add')` from list route
 * - To: `router.goBack()` after successful addition
 * - Close: `sheetRef.current?.hide({payload: result})`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Allowed currencies and configuration
 * - Params: None (direct navigation)
 *
 * **Flow:** Load discovered mints → search/filter → select mints → add to wallet → close
 *
 * @see {@link ./list}
 * @see {@link ./info}
 */

/**
 * Handles mint addition
 *
 * @async
 * @description Adds selected mints to wallet via CocoManager, shows progress, closes sheet
 *
 * **Process:** validate → addMint() for each → show results → sheetRef.hide()
 * **Effects:** Wallet updates, popup notifications, sheet close
 *
 * @returns {Promise<void>} Resolves when addition is complete
 * @throws {Error} When CocoManager is not initialized or mint addition fails
 */
const handleSave = async () => {
  // Implementation
};
```

## Best Practices

### 1. Consistency

- Always use the same JSDoc structure for similar components
- Follow the established patterns in the codebase
- Use consistent terminology throughout

### 2. Completeness

- Document all public functions and components
- Include examples for complex functionality
- Document all parameters and return values

### 3. Clarity

- Use clear, concise language
- Avoid technical jargon when possible
- Include practical examples

### 4. Maintenance

- Update JSDoc when code changes
- Remove outdated documentation
- Keep examples current

### 5. Sheet-Specific Guidelines

- Always document navigation patterns
- Include data flow descriptions
- Document user flows clearly
- Use consistent route naming

## Additional Documentation Patterns

### 8. Property Documentation

For class properties, use inline JSDoc comments:

```typescript
class DeviceChecker {
  /** The target platform OS being checked */
  private platformOS: string | null = null;
  /** The parsed version number of the current platform */
  private platformVersion: number | null = null;
}
```

### 9. Complex Utility Functions

For complex utility functions, include detailed behavior descriptions:

```typescript
/**
 * Utility function to merge Tailwind CSS classes with proper conflict resolution
 *
 * This function combines clsx for conditional class handling and tailwind-merge
 * for intelligent Tailwind CSS class merging. It resolves conflicts by keeping
 * the last conflicting class and removes duplicates.
 *
 * @param inputs - Variable number of class values to merge (strings, objects, arrays, etc.)
 * @returns A merged string of CSS classes with conflicts resolved and duplicates removed
 *
 * @example
 * // Basic usage
 * cn('px-2 py-1', 'px-4') // 'py-1 px-4' (px-2 is overridden by px-4)
 *
 * // Conditional classes
 * cn('text-red-500', { 'text-blue-500': isBlue }) // 'text-blue-500' if isBlue is true
 *
 * // Complex conditional logic
 * cn('base-class', condition && 'conditional-class', isActive && 'active-class')
 *
 * // Arrays and mixed types
 * cn(['class1', 'class2'], { 'class3': true }, 'class4')
 *
 * @see {@link https://github.com/dcastil/tailwind-merge} tailwind-merge documentation
 * @see {@link https://github.com/lukeed/clsx} clsx documentation
 */
```

### 10. Export Documentation

For main exports, provide comprehensive usage examples:

```typescript
/**
 * Pre-configured DeviceChecker instance for easy platform version checking
 *
 * This is the main export of the module, providing a ready-to-use instance
 * of the DeviceChecker class for checking platform versions throughout the application.
 *
 * @example
 * // Import and use
 * import { device } from '@/helper/version';
 *
 * if (device.platform('ios').gte(12)) {
 *   // iOS 12+ specific code
 * }
 */
export const device = new DeviceChecker();
```

### 11. Edge Case Documentation

Document edge cases and special behavior:

```typescript
/**
 * Checks if a melt quote has expired based on its expiry timestamp
 *
 * This function checks if the current time exceeds the melt quote's expiry time.
 * If no expiry timestamp exists, it returns false (not expired).
 *
 * @param meltQuote - The melt quote response containing the expiry timestamp
 * @returns True if the melt quote has expired, false if not expired or if no expiry exists
 *
 * @example
 * const quote = { expiry: 1234567890, ... };
 * const isExpired = meltQuoteExpired(quote);
 * if (isExpired) {
 *   // Handle expired melt quote - show refresh component
 * }
 */
```

This JSDoc system ensures comprehensive documentation that helps developers understand the codebase structure, especially the complex sheet system with its multi-route navigation patterns.
