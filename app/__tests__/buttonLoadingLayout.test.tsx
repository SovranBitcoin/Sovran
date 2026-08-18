/**
 * @jest-environment node
 */

import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Button } from '@/shared/ui/primitives/Button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'black') : 'black',
}));

jest.mock('hex-color-opacity', () => jest.fn(() => 'black'));

jest.mock('@/shared/lib/version', () => ({
  supportsBlur: () => false,
  supportsLiquidGlass: () => false,
  liquidGlassModifiers: <T,>(...modifiers: T[]) => modifiers,
}));

jest.mock('@/shared/lib/logger', () => ({
  log: {
    warn: jest.fn(),
  },
}));

jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: {
    actionHaptic: jest.fn(),
    buttonHaptic: jest.fn(),
    destructiveHaptic: jest.fn(),
    errorHaptic: jest.fn(),
    successHaptic: jest.fn(),
    warningHaptic: jest.fn(),
  },
}));

jest.mock('@/shared/ui/primitives/Spinner', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    Spinner: ({ style }: { style?: StyleProp<ViewStyle> }) =>
      ReactActual.createElement(View, { testID: 'spinner-loading-indicator', style }),
  };
});

jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-native-masked-view/masked-view', () => 'MaskedView');

jest.mock(
  'assets/icons',
  () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');

    return {
      __esModule: true,
      default: ({ name, ...props }: { name: string }) =>
        ReactActual.createElement(View, { testID: `icon-${name}`, ...props }),
    };
  },
  { virtual: true }
);

type JsonNode = ReturnType<TestRenderer.ReactTestRenderer['toJSON']>;
let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

function nodeContainsText(node: JsonNode, text: string): boolean {
  if (!node) return false;
  if (typeof node === 'string') return node === text;
  if (Array.isArray(node)) return node.some((child) => nodeContainsText(child, text));
  return node.children?.some((child) => nodeContainsText(child as JsonNode, text)) ?? false;
}

function findNodeByTestID(node: JsonNode, testID: string): JsonNode | null {
  if (!node || typeof node === 'string') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findNodeByTestID(child, testID);
      if (match) return match;
    }
    return null;
  }
  if (node.props?.testID === testID || node.props?.['data-testid'] === testID) return node;
  for (const child of node.children ?? []) {
    const match = findNodeByTestID(child as JsonNode, testID);
    if (match) return match;
  }
  return null;
}

function hasHiddenContainerForText(node: JsonNode, text: string): boolean {
  if (!node || typeof node === 'string') return false;
  if (Array.isArray(node)) return node.some((child) => hasHiddenContainerForText(child, text));

  const style = StyleSheet.flatten(node.props?.style);
  if (style?.opacity === 0 && nodeContainsText(node, text)) return true;

  return (
    node.children?.some((child) => hasHiddenContainerForText(child as JsonNode, text)) ?? false
  );
}

describe('Button loading layout', () => {
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('props.pointerEvents is deprecated')) return;
      throw new Error(`Unexpected console.warn: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('keeps the last non-loading label mounted and hidden while showing the spinner', () => {
    const onPress = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<Button text="Confirm" variant="primary" onPress={onPress} />);
    });

    act(() => {
      renderer.update(<Button text="Sending..." variant="primary" loading onPress={onPress} />);
    });

    const tree = renderer!.toJSON();

    expect(nodeContainsText(tree, 'Confirm')).toBe(true);
    expect(nodeContainsText(tree, 'Sending...')).toBe(false);
    expect(hasHiddenContainerForText(tree, 'Confirm')).toBe(true);
    expect(findNodeByTestID(tree, 'spinner-loading-indicator')).not.toBeNull();

    act(() => {
      renderer.unmount();
    });
  });
});
