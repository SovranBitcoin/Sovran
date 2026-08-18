/**
 * Jest stand-in for `uniwind`.
 *
 * The real module reaches into React Native's native runtime at import time
 * (`NativeModules.…constants`), which the `jest-expo/node` environment does not
 * provide — importing it anywhere in a component tree fails the whole suite
 * with `Cannot read properties of undefined (reading 'constants')`.
 *
 * Jest picks this up automatically for the `uniwind` node_modules package; no
 * `jest.mock('uniwind')` call is needed. Tests that want specific resolved
 * values still mock `@/shared/hooks/useThemeColor` directly, as they did before
 * uniwind was ever reachable from a test.
 */

/** Class props are inert under test: render the component as-is. */
const withUniwind = (Component) => Component;

/** No variables are registered under test, so every lookup is unresolved. */
const useCSSVariable = (name) => (Array.isArray(name) ? name.map(() => undefined) : undefined);

const useResolveClassNames = () => ({});
const useUniwind = () => ({});

const Uniwind = {
  updateCSSVariables: () => {},
  updateInsets: () => {},
  setTheme: () => {},
};

const passthrough = ({ children }) => children ?? null;

module.exports = {
  __esModule: true,
  withUniwind,
  useCSSVariable,
  useResolveClassNames,
  useUniwind,
  Uniwind,
  ScopedTheme: passthrough,
  ScopedVariables: passthrough,
  LayoutDirection: passthrough,
};
