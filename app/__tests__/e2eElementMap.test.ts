/**
 * The app's own map of its controls, for the end-to-end runner.
 */
import { collectElements, installFiberRootCapture, windowSize } from '@/shared/lib/e2e/elementMap';

interface TestFiber {
  tag: number;
  type?: unknown;
  memoizedProps?: unknown;
  child: TestFiber | null;
  sibling: TestFiber | null;
  return: TestFiber | null;
  stateNode?: unknown;
  rect?: { x: number; y: number; width: number; height: number };
}

/** Build a fiber and link its children the way React does. */
function fiber(tag: number, fields: Partial<TestFiber>, children: TestFiber[] = []): TestFiber {
  const node: TestFiber = { tag, child: null, sibling: null, return: null, ...fields };
  children.forEach((child, index) => {
    child.return = node;
    child.sibling = children[index + 1] ?? null;
  });
  node.child = children[0] ?? null;
  return node;
}
const view = (props: Record<string, unknown>, rect: TestFiber['rect'], children?: TestFiber[]) =>
  fiber(5, { memoizedProps: props, rect }, children);
const textNode = (value: string) => fiber(6, { memoizedProps: value });
function Screen() {
  return null;
}
const page = (name: string, children: TestFiber[]) =>
  fiber(0, { type: Screen, memoizedProps: { name } }, children);

const capturing = (root: TestFiber) => ({
  roots: new Set([{ current: root }]),
  measure: (node: TestFiber) => node.rect ?? null,
});

const BOX = { x: 16, y: 700, width: 370, height: 56 };

describe('collectElements', () => {
  it('lists a control with its test id, label, frame and the page it is on', () => {
    const root = fiber(3, {}, [
      page('SendScreen', [
        view({ testID: 'send-method-createEcash', accessibilityLabel: 'Create Ecash' }, BOX),
      ]),
    ]);

    expect(collectElements(capturing(root))).toEqual([
      {
        id: 'send-method-createEcash',
        label: 'Create Ecash',
        page: 'SendScreen',
        x: 16,
        y: 700,
        width: 370,
        height: 56,
      },
    ]);
  });

  it('reads the text an element draws, so a label on screen can be found', () => {
    const root = fiber(3, {}, [view({}, BOX, [textNode('Continue to '), textNode('Privacy')])]);

    expect(collectElements(capturing(root))).toEqual([{ text: 'Continue to Privacy', ...BOX }]);
  });

  it('says when a control is disabled, and carries a probe value', () => {
    const root = fiber(3, {}, [
      view({ testID: 'amount-next', accessibilityState: { disabled: true } }, BOX),
      view({ testID: 'amount-state', accessibilityValue: { text: '40' } }, BOX),
    ]);

    expect(collectElements(capturing(root))).toEqual([
      { id: 'amount-next', disabled: true, ...BOX },
      { id: 'amount-state', value: '40', ...BOX },
    ]);
  });

  it('keeps tree order across pages and leaves out what has no name or no frame', () => {
    const root = fiber(3, {}, [
      page('WalletScreen', [view({ testID: 'wallet-send' }, BOX), view({}, BOX)]),
      page('SendScreen', [
        view({ testID: 'not-laid-out' }, undefined),
        view({ testID: 'paste' }, BOX),
      ]),
    ]);

    expect(collectElements(capturing(root)).map((element) => [element.page, element.id])).toEqual([
      ['WalletScreen', 'wallet-send'],
      ['SendScreen', 'paste'],
    ]);
  });
});

describe('windowSize', () => {
  it("is the frame of the app's outermost view", () => {
    const root = fiber(3, {}, [
      fiber(0, {}, [
        view({}, { x: 0, y: 0, width: 402, height: 874 }, [view({ testID: 'a' }, BOX)]),
      ]),
    ]);

    expect(windowSize(capturing(root))).toEqual({ width: 402, height: 874 });
  });
});

describe('installFiberRootCapture', () => {
  it('remembers a root React commits and forgets one that is unmounted', () => {
    const target: Record<string, unknown> = {
      nativeFabricUIManager: {
        getBoundingClientRect: (node: { rect: [number, number, number, number] }) => node.rect,
      },
    };
    const capture = installFiberRootCapture(target);
    const hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__ as {
      inject: (renderer: unknown) => number;
      onCommitFiberRoot: (id: number, root: { current: TestFiber | null }) => void;
    };
    const laidOut = {
      memoizedProps: { testID: 'a' },
      stateNode: { node: { rect: [16, 700, 370, 56] } },
    };
    const root = { current: fiber(3, {}, [fiber(5, laidOut)]) };

    hook.inject({});
    hook.onCommitFiberRoot(1, root);
    expect(collectElements(capture!)).toEqual([{ id: 'a', ...BOX }]);

    root.current = fiber(3, {});
    hook.onCommitFiberRoot(1, root);
    expect(collectElements(capture!)).toEqual([]);
  });

  it('leaves an existing hook, such as React DevTools, in place', () => {
    const existing = { supportsFiber: true };
    const target: Record<string, unknown> = { __REACT_DEVTOOLS_GLOBAL_HOOK__: existing };

    expect(installFiberRootCapture(target)).toBeNull();
    expect(target.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(existing);
  });
});
