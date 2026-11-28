/**
 * @jest-environment node
 */
import { Pressable as RNPressable, StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { Pressable } from '@/shared/ui/primitives/Pressable';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { buttonHaptic: jest.fn(async () => undefined) },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * The single-flight guard drops a second tap while the first tap's promise is
 * pending. It must drop only the duplicate effect: press-in, the pressed look
 * and the enabled state stay live, so the control still answers the finger.
 */
it('keeps press-in and the pressed look live while the previous tap is still running', async () => {
  const gate = deferred();
  const onPress = jest.fn(() => gate.promise);
  const onPressIn = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <Pressable onPress={onPress} onPressIn={onPressIn}>
        <Text>Go</Text>
      </Pressable>
    );
  });
  const host = () => tree.root.findByType(RNPressable).props;

  await act(async () => {
    void host().onPress({});
  });
  expect(onPress).toHaveBeenCalledTimes(1);

  act(() => host().onPressIn({}));
  expect(onPressIn).toHaveBeenCalledTimes(1);
  expect(host().disabled).toBeFalsy();
  expect(StyleSheet.flatten(host().style({ pressed: true, hovered: false })).opacity).toBe(0.7);

  await act(async () => {
    void host().onPress({});
  });
  expect(onPress).toHaveBeenCalledTimes(1);

  await act(async () => gate.resolve());
  await act(async () => {
    void host().onPress({});
  });
  expect(onPress).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});
