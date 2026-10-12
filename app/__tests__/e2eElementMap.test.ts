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

/** What a navigator hands each of its pages: its navigation object, which knows if it is in front. */
const navigatorPage = (focused: boolean, children: TestFiber[]) =>
  fiber(
    10,
    { memoizedProps: { value: { isFocused: () => focused, navigate: () => {} } } },
    children
  );

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

describe('what a person cannot see or touch', () => {
  const WINDOW = { width: 402, height: 874 };

  it('leaves out a page that is not in front, such as another tab', () => {
    const root = fiber(3, {}, [
      navigatorPage(false, [page('feed', [view({ testID: 'header-profile-avatar' }, BOX)])]),
      navigatorPage(true, [page('index', [view({ testID: 'header-profile-avatar' }, BOX)])]),
    ]);

    expect(collectElements(capturing(root), WINDOW).map((element) => element.page)).toEqual([
      'index',
    ]);
  });

  it('keeps a page inside a navigator that is itself in front', () => {
    const root = fiber(3, {}, [
      navigatorPage(true, [
        navigatorPage(true, [page('index', [view({ testID: 'wallet-send' }, BOX)])]),
        navigatorPage(false, [page('feed', [view({ testID: 'feed-list' }, BOX)])]),
      ]),
    ]);

    expect(collectElements(capturing(root), WINDOW).map((element) => element.id)).toEqual([
      'wallet-send',
    ]);
  });

  it('leaves out what is laid out wholly outside the window, such as a closed drawer', () => {
    const root = fiber(3, {}, [
      view({ testID: 'drawer-menu-settings' }, { x: -320, y: 300, width: 300, height: 48 }),
      view({ testID: 'below-the-fold' }, { x: 16, y: 874, width: 370, height: 56 }),
      view({ testID: 'half-on-screen' }, { x: 16, y: 850, width: 370, height: 56 }),
    ]);

    expect(collectElements(capturing(root), WINDOW).map((element) => element.id)).toEqual([
      'half-on-screen',
    ]);
  });

  it('does not mistake some other context value for a page', () => {
    const root = fiber(3, {}, [
      fiber(10, { memoizedProps: { value: { isFocused: false } } }, [
        view({ testID: 'wallet-send' }, BOX),
      ]),
    ]);

    expect(collectElements(capturing(root), WINDOW)).toHaveLength(1);
  });
});

describe('a control in a page header', () => {
  const WINDOW = { width: 402, height: 874 };
  const headerBar = (rect: TestFiber['rect'], children: TestFiber[]) =>
    fiber(5, { type: 'RNSScreenStackHeaderConfig', memoizedProps: {}, rect }, children);

  it('is placed just below the status bar when the layout puts its bar above the window', () => {
    // A page drawn under its header: the layout says the 54-point bar ends where the window begins.
    const root = fiber(3, {}, [
      page('index', [
        headerBar({ x: 0, y: -54, width: 402, height: 54 }, [
          view({ testID: 'wallet-search-toggle' }, { x: 338, y: -49, width: 44, height: 44 }),
        ]),
        view({ testID: 'wallet-send' }, BOX),
      ]),
    ]);

    const elements = collectElements({ ...capturing(root), topInset: () => 62 }, WINDOW);

    expect(elements.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: 'wallet-search-toggle', x: 338, y: 67 },
      { id: 'wallet-send', x: 16, y: 700 },
    ]);
  });

  it('is left where it is when the layout already has its bar below the status bar', () => {
    const root = fiber(3, {}, [
      headerBar({ x: 0, y: 62, width: 402, height: 54 }, [
        view({ testID: 'header-back' }, { x: 8, y: 67, width: 44, height: 44 }),
      ]),
    ]);

    expect(collectElements({ ...capturing(root), topInset: () => 62 }, WINDOW)[0].y).toBe(67);
  });
});

describe('a page presented as a sheet', () => {
  const WINDOW = { width: 402, height: 874 };
  const sheetPage = (children: TestFiber[]) =>
    fiber(
      5,
      {
        type: 'RNSModalScreen',
        memoizedProps: {},
        rect: { x: 0, y: 0, width: 402, height: 802 },
      },
      children
    );

  it('places its controls where the sheet is, 72 points down a window it does not fill', () => {
    const root = fiber(3, {}, [
      sheetPage([
        fiber(
          5,
          {
            type: 'RNSScreenStackHeaderConfig',
            memoizedProps: {},
            rect: { x: 0, y: -54, width: 402, height: 54 },
          },
          [view({ testID: 'mint-add-search-toggle' }, { x: 338, y: -54, width: 44, height: 44 })]
        ),
        view({ testID: 'mint-currency-tab-ALL' }, { x: 16, y: 70, width: 88, height: 48 }),
      ]),
    ]);

    const elements = collectElements({ ...capturing(root), topInset: () => 62 }, WINDOW);

    expect(elements.map(({ id, y }) => ({ id, y }))).toEqual([
      { id: 'mint-add-search-toggle', y: 72 },
      { id: 'mint-currency-tab-ALL', y: 142 },
    ]);
  });

  it('leaves a full-height page, and a short page that is not a sheet, where they are', () => {
    const tabPage = fiber(
      5,
      { type: 'RNSScreen', memoizedProps: {}, rect: { x: 0, y: 0, width: 402, height: 791 } },
      [view({ testID: 'wallet-send' }, BOX)]
    );

    expect(collectElements(capturing(fiber(3, {}, [tabPage])), WINDOW)[0].y).toBe(700);
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
