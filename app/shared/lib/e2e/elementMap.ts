/**
 * Where the controls are, as the app itself knows them (ADR 0033).
 *
 * The end-to-end runner used to find a control by reading the simulator's
 * accessibility tree, which costs most of a second per read and cannot see into
 * some native overlays. The app already has every control in its React tree
 * with its test id, label and laid-out frame, so in the test build it answers
 * the runner directly, in a few milliseconds.
 *
 * React offers one supported way to see its tree from outside a component: the
 * hook renderers report to when one exists at start-up, the same one React
 * DevTools uses. This module installs a minimal one, in the test build only,
 * that does nothing but remember the tree's roots.
 */
import { IS_E2E_LOG_BUILD } from '@/shared/lib/loggerCore';

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

export interface ElementInfo {
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
  /** The frame a host fiber is laid out at, in window points. */
  measure: (fiber: Fiber) => Rect | null;
  /** Whether a renderer has reported to the hook yet. */
  hasRenderer?: () => boolean;
}

/**
 * Install the hook a React renderer reports to. Must run before the renderer
 * loads. An existing hook (React DevTools in a development build) is left alone.
 */
export function installFiberRootCapture(target: Record<string, unknown>): FiberCapture | null {
  if (target.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined) return null;
  const roots = new Set<FiberRoot>();
  let reported = false;
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
    roots,
    measure: (fiber) => {
      const node = (fiber.stateNode as { node?: unknown } | null | undefined)?.node;
      const fabric = target.nativeFabricUIManager as FabricUIManager | undefined;
      const rect = node ? fabric?.getBoundingClientRect?.(node, true) : null;
      return rect ? { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } : null;
    },
    hasRenderer: () => reported,
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
 * in tree order, with the frame it is laid out at.
 */
export function collectElements(capture: FiberCapture): ElementInfo[] {
  const found: ElementInfo[] = [];
  const visit = (start: Fiber, startPage: string | undefined) => {
    // Iterative: a screen's tree is deeper than a comfortable call stack.
    const stack: [Fiber, string | undefined][] = [[start, startPage]];
    for (let next = stack.pop(); next; next = stack.pop()) {
      const [fiber, inherited] = next;
      const page = pageNameOf(fiber) ?? inherited;
      if (fiber.tag === HOST_COMPONENT) {
        const props = (fiber.memoizedProps ?? {}) as Record<string, unknown>;
        const id = text(props.testID);
        const label = text(props.accessibilityLabel) ?? text(props['aria-label']);
        const own = ownText(fiber);
        if (id ?? label ?? own) {
          const rect = capture.measure(fiber);
          if (rect) {
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
      if (fiber.sibling) stack.push([fiber.sibling, inherited]);
      if (fiber.child) stack.push([fiber.child, page]);
    }
  };
  for (const root of capture.roots) if (root.current) visit(root.current, undefined);
  return found;
}

const capture = IS_E2E_LOG_BUILD
  ? installFiberRootCapture(globalThis as unknown as Record<string, unknown>)
  : null;

/** The frame of the app's outermost view, which fills its window. */
export function windowSize(from: FiberCapture): { width: number; height: number } {
  for (const root of from.roots) {
    for (let fiber = root.current; fiber; fiber = fiber.child) {
      if (fiber.tag !== HOST_COMPONENT) continue;
      const rect = from.measure(fiber);
      if (rect) return { width: rect.width, height: rect.height };
    }
  }
  return { width: 0, height: 0 };
}

/**
 * The window and the elements in it now; empty outside the test build. `source`
 * says why a map is empty: the hook was not installed (`off`, or another one was
 * there first), no renderer reported to it, or React has committed no tree.
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
      source: IS_E2E_LOG_BUILD ? 'another hook was installed first' : 'off',
    };
  return {
    ...windowSize(capture),
    elements: collectElements(capture),
    source: `renderer ${capture.hasRenderer?.() ? 'reported' : 'never reported'}, ${capture.roots.size} root(s)`,
  };
}
