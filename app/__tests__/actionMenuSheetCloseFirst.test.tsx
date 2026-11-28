/**
 * @jest-environment node
 *
 * An action-menu sheet item closes the sheet before its action runs, so a
 * slow action (redeem, pay, recover) never holds the sheet on screen; an
 * item marked `keepOpen` leaves it up, and the close is not a dismiss.
 */
import TestRenderer, { act } from 'react-test-renderer';

import { ActionMenuSheetContent } from '@/shared/lib/popup/popups/actionMenuSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/lib/logger', () => {
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { log: logger, storeLog: logger, redactError: (error: unknown) => error };
});
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({
  E2EActionMenuRenderMarker: () => null,
  E2EActionMenuTargetMarker: () => null,
}));
jest.mock('@/shared/lib/popup/popups/sheetMenuRow', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children);
  return {
    MenuItem: (props: Record<string, unknown>) =>
      ReactActual.createElement('MenuItem', props, props.children as React.ReactNode),
    MenuRowTint: passthrough,
    MenuTitle: passthrough,
    SheetMenuRowContent: () => null,
  };
});
jest.mock('assets/icons', () => () => null);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function mount(
  buttons: { testID: string; text: string; onPress: () => Promise<void>; keepOpen?: boolean }[]
) {
  const close = jest.fn();
  const onDismiss = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ActionMenuSheetContent
        payload={{ title: 'Pay', buttons, onDismiss } as never}
        close={close}
        setFooterConfig={jest.fn()}
      />
    );
  });
  const press = (testID: string) => act(() => tree.root.findByProps({ testID }).props.onPress());
  return { tree, close, onDismiss, press };
}

it('closes the sheet before the item action finishes', async () => {
  const gate = deferred();
  const onPress = jest.fn(() => gate.promise);
  const { tree, close, onDismiss, press } = mount([{ testID: 'redeem', text: 'Redeem', onPress }]);

  press('redeem');
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);

  await act(async () => gate.resolve());
  expect(close).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
  expect(onDismiss).not.toHaveBeenCalled();
});

it('leaves a keepOpen item sheet up', async () => {
  const onPress = jest.fn(async () => undefined);
  const { tree, close, press } = mount([{ testID: 'swap', text: 'More', onPress, keepOpen: true }]);
  press('swap');
  await act(async () => Promise.resolve());
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
