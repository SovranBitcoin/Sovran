/**
 * Where the controls are, as the app itself knows them (ADR 0033).
 *
 * The end-to-end runner used to find a control by reading the simulator's
 * accessibility tree, which costs most of a second per read and cannot see into
 * some native overlays. The app already has every control in its React tree
 * with its test id, label and laid-out frame, so in the test build it answers
 * the runner directly, in a few milliseconds.
 *
 * React renderers report their roots through the DevTools hook. In the test
 * build, read its live root registry or install a minimal hook when none exists.
 * The development hook keeps ownership of its callbacks and root lifecycle.
 */
import { IS_E2E_LOG_BUILD } from '@/shared/lib/loggerCore';
import { z } from 'zod';
import { Platform } from 'react-native';

/** The parts of a React fiber that are read. */
interface Fiber {
  tag: number;
  type?: unknown;
  memoizedProps?: unknown;
  /** For a host component under Fabric: `{ node }`, the shadow node. */
  stateNode?: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}
interface FiberRoot {
  current: Fiber | null;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Fabric's own layout query, the one `getBoundingClientRect` is built on. */
interface FabricUIManager {
  getBoundingClientRect?: (
    node: unknown,
    includeTransform: boolean
  ) => [number, number, number, number] | null | undefined;
}

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;
const CONTEXT_PROVIDER = 10;
/** The native view that holds a page header's buttons and title. */
const HEADER_BAR = 'RNSScreenStackHeaderConfig';
/**
 * A header bar's buttons sit a little below where the bar is taken to begin: by
 * nothing on a full-screen page, and by about 15 points on a page drawn as a
 * card or a sheet (measured from pictures: 78 against 62, and 87 against 72).
 * Placing every bar 8 points lower keeps a tap on a 44-point button well
 * inside it in all three; without it a card's Back was tapped at its top edge
 * and missed.
 */
const BAR_SITS_LOWER = 8;
/** The native views of one page of a navigator: pushed, and presented over the others. */
const PAGE_VIEW = 'RNSScreen';
const PRESENTED_PAGE_VIEW = 'RNSModalScreen';

interface ElementInfo {
  /** `testID`. */
  id?: string;
  /** Accessibility label. */
  label?: string;
  /** Accessibility value text, which is how an `E2EAccessibilityProbe` carries state. */
  value?: string;
  /** Text drawn directly inside the element. */
  text?: string;
  disabled?: true;
  /** `name` of the nearest `Screen` around the element. */
  page?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FiberCapture {
  roots: Set<FiberRoot>;
  /** Android Fabric includes a viewport offset that physical device taps do not. */
  normalizeViewportOrigin?: boolean;
  /** The frame a host fiber is laid out at, in window points. */
  measure: (fiber: Fiber) => Rect | null;
  /** Whether a renderer has reported to the hook yet. */
  hasRenderer?: () => boolean;
  /** Height of the status bar area at the top of the window, in points. */
  topInset?: () => number;
}

const devToolsHookSchema = z.object({
  renderers: z.instanceof(Map),
  getFiberRoots: z.function(),
});

/**
 * Install the hook a React renderer reports to. Must run before the renderer
 * loads. Read an existing DevTools root registry without modifying its hook.
 */
export function installFiberRootCapture(target: Record<string, unknown>): FiberCapture | null {
  const existing = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const devTools = devToolsHookSchema.safeParse(existing);
  if (existing !== undefined && !devTools.success) return null;
  const roots = new Set<FiberRoot>();
  let reported = false;
  if (existing === undefined)
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      checkDCE() {},
      inject() {
        reported = true;
        return 1;
      },
      onCommitFiberRoot(_rendererId: number, root: FiberRoot) {
        // A root that committed nothing has been unmounted.
        if (root.current?.child) roots.add(root);
        else roots.delete(root);
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onScheduleFiberRoot() {},
      setStrictMode() {},
    };
  return {
    normalizeViewportOrigin: Platform.OS === 'android',
    get roots() {
      if (!devTools.success) return roots;
      const live = new Set<FiberRoot>();
      for (const id of devTools.data.renderers.keys()) {
        const mounted: unknown = Reflect.apply(devTools.data.getFiberRoots, existing, [id]);
        if (!(mounted instanceof Set))
          throw new Error('DevTools returned an invalid root registry');
        // React DevTools owns these live FiberRoot references, just as the
        // renderer owns the roots passed to our release-build commit hook.
        for (const root of mounted as Set<FiberRoot>) live.add(root);
      }
      return live;
    },
    measure: (fiber) => {
      const node = (fiber.stateNode as { node?: unknown } | null | undefined)?.node;
      const fabric = target.nativeFabricUIManager as FabricUIManager | undefined;
      const rect = node ? fabric?.getBoundingClientRect?.(node, true) : null;
      return rect ? { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } : null;
    },
    hasRenderer: () => (devTools.success ? devTools.data.renderers.size > 0 : reported),
    topInset: () => {
      try {
        const safeArea =
          require('react-native-safe-area-context') as typeof import('react-native-safe-area-context');
        return safeArea.initialWindowMetrics?.insets.top ?? 0;
      } catch {
        return 0;
      }
    },
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function pageNameOf(fiber: Fiber): string | undefined {
  if (typeof fiber.type !== 'function') return undefined;
  const component = fiber.type as { name?: unknown; displayName?: unknown };
  if ((component.displayName ?? component.name) !== 'Screen') return undefined;
  return text((fiber.memoizedProps as { name?: unknown } | null)?.name);
}

/**
 * Whether a fiber hands its subtree the navigation object of a page that is
 * not in front: another tab, or a page with another pushed over it. Every
 * navigator gives each of its pages one, whatever it is built on, so this needs
 * to know nothing about tabs, stacks or drawers.
 */
function isPageNotInFront(fiber: Fiber): boolean {
  if (fiber.tag !== CONTEXT_PROVIDER) return false;
  const value = (fiber.memoizedProps as { value?: unknown } | null)?.value as
    { isFocused?: unknown; navigate?: unknown } | null | undefined;
  if (typeof value?.isFocused !== 'function' || typeof value.navigate !== 'function') return false;
  try {
    return (value.isFocused as () => boolean)() === false;
  } catch {
    return false;
  }
}

/** Text nodes that are direct children of a host element, joined. */
function ownText(fiber: Fiber): string | undefined {
  let joined = '';
  for (let child = fiber.child; child; child = child.sibling)
    if (child.tag === HOST_TEXT && typeof child.memoizedProps === 'string')
      joined += child.memoizedProps;
  return text(joined);
}

/**
 * Every element a runner could name (it has a test id, a label or its own text),
 * in tree order, with the frame it is laid out at. Left out: pages that are not
 * in front, and, when the window's size is given, anything laid out wholly
 * outside it (a closed drawer, the far end of a list). A person can neither
 * see nor touch those.
 */
export function collectElements(
  capture: FiberCapture,
  window?: { width: number; height: number }
): ElementInfo[] {
  const outside = (rect: Rect) =>
    window !== undefined &&
    window.width > 0 &&
    (rect.x + rect.width <= 0 ||
      rect.y + rect.height <= 0 ||
      rect.x >= window.width ||
      rect.y >= window.height);
  const found: ElementInfo[] = [];
  const topInset = capture.topInset?.() ?? 0;
  const visit = (start: Fiber, origin: { x: number; y: number }) => {
    // Iterative: a screen's tree is deeper than a comfortable call stack.
    // Carried down: the page a fiber is on, the top of the header bar it is in,
    // and how far down the window the sheet it is on begins.
    const stack: [Fiber, string | undefined, number | undefined, number][] = [
      [start, undefined, undefined, 0],
    ];
    for (let next = stack.pop(); next; next = stack.pop()) {
      const [fiber, inherited, inheritedBar, inheritedSheet] = next;
      const page = pageNameOf(fiber) ?? inherited;
      let barTop = inheritedBar;
      let sheetTop = inheritedSheet;
      if (fiber.tag === HOST_COMPONENT && fiber.type === HEADER_BAR) {
        const bar = capture.measure(fiber);
        if (bar && bar.height > 0) barTop = bar.y;
      }
      if (
        fiber.tag === HOST_COMPONENT &&
        (fiber.type === PAGE_VIEW || fiber.type === PRESENTED_PAGE_VIEW) &&
        window
      ) {
        // A page presented as a sheet is laid out from its own top, and sits at
        // the bottom of the window with the page beneath showing above it.
        const presented = (fiber.memoizedProps as { stackPresentation?: unknown } | null)
          ?.stackPresentation;
        const sheet = capture.measure(fiber);
        const isPresented =
          fiber.type === PRESENTED_PAGE_VIEW ||
          (typeof presented === 'string' && /modal|sheet/i.test(presented));
        if (sheet && isPresented && sheet.height > 0 && sheet.height < window.height)
          sheetTop = window.height - sheet.height;
      }
      if (fiber.tag === HOST_COMPONENT) {
        const props = (fiber.memoizedProps ?? {}) as Record<string, unknown>;
        const id = text(props.testID);
        const label = text(props.accessibilityLabel) ?? text(props['aria-label']);
        const own = ownText(fiber);
        if (id ?? label ?? own) {
          const laidOut = capture.measure(fiber);
          // The layout places a header bar above its page, which for a page drawn
          // under its header is above the window. The bar is really just below
          // the status bar; what is in it keeps its place within the bar.
          // On a sheet the bar is at the sheet's top instead. That is iOS: Android lays
          // the bar out where it is drawn, below a banner too, and the inset guess put
          // its buttons some 30 points low (the drawer button was tapped beneath itself).
          const rect = !laidOut
            ? null
            : barTop !== undefined && !capture.normalizeViewportOrigin
              ? { ...laidOut, y: (sheetTop || topInset) + BAR_SITS_LOWER + (laidOut.y - barTop) }
              : { ...laidOut, y: laidOut.y + sheetTop - origin.y };
          if (rect) rect.x -= origin.x;
          if (rect && !outside(rect)) {
            const state = props.accessibilityState as { disabled?: unknown } | undefined;
            const value = text((props.accessibilityValue as { text?: unknown } | undefined)?.text);
            found.push({
              ...(id ? { id } : {}),
              ...(label ? { label } : {}),
              ...(value ? { value } : {}),
              ...(own ? { text: own } : {}),
              ...(state?.disabled === true || props.disabled === true ? { disabled: true } : {}),
              ...(page ? { page } : {}),
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            });
          }
        }
      }
      // Sibling first, so the child is popped first and order stays the tree's.
      if (fiber.sibling) stack.push([fiber.sibling, inherited, inheritedBar, inheritedSheet]);
      if (fiber.child && !isPageNotInFront(fiber))
        stack.push([fiber.child, page, barTop, sheetTop]);
    }
  };
  for (const root of capture.roots) {
    if (!root.current) continue;
    // Each React surface has its own viewport offset. Header y is synthesized
    // above from window insets, so only its x uses this correction.
    const origin = capture.normalizeViewportOrigin ? rootFrame(capture, root) : null;
    visit(root.current, origin ?? { x: 0, y: 0 });
  }
  return found;
}

const capture = IS_E2E_LOG_BUILD
  ? installFiberRootCapture(globalThis as unknown as Record<string, unknown>)
  : null;

function rootFrame(from: FiberCapture, root: FiberRoot): Rect | null {
  for (let fiber = root.current; fiber; fiber = fiber.child) {
    if (fiber.tag !== HOST_COMPONENT) continue;
    const rect = from.measure(fiber);
    if (rect) return rect;
  }
  return null;
}

/** The frame of the app's outermost view, which fills its window. */
export function windowSize(from: FiberCapture): { width: number; height: number } {
  for (const root of from.roots) {
    const rect = rootFrame(from, root);
    if (rect) return { width: rect.width, height: rect.height };
  }
  return { width: 0, height: 0 };
}

/**
 * The window and the elements in it now; empty outside the test build. `source`
 * says why a map is empty: capture is off, an existing hook is incompatible,
 * no renderer reported to it, or React has committed no tree.
 */
export function readScreen(): {
  width: number;
  height: number;
  elements: ElementInfo[];
  source: string;
} {
  if (!capture)
    return {
      width: 0,
      height: 0,
      elements: [],
      source: IS_E2E_LOG_BUILD ? 'existing hook has no compatible root registry' : 'off',
    };
  const window = windowSize(capture);
  return {
    ...window,
    elements: collectElements(capture, window),
    source: `renderer ${capture.hasRenderer?.() ? 'reported' : 'never reported'}, ${capture.roots.size} root(s)`,
  };
}
