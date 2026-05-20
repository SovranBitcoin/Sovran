// ═══════════════════════════════════════════════════════════════════════════════
// UI CONTENT LOGGING — <Log> wrapper + UIPath context
// ═══════════════════════════════════════════════════════════════════════════════
//
// Gives an LLM "eyes" into what the user sees, without screenshots.
//
// The <Log> component logs visible text (string children, accessibilityLabels,
// placeholder text) and component names on mount and diffs on re-render.
//
// Layout-invisible when no style prop is provided — safe inside ScrollViews,
// ModalLayoutWrappers, and any other container. Only wraps in a View when
// an explicit style is passed (for screens where Log replaces the outermost View).

import { createContext, useContext, useEffect, useRef } from 'react';
import React, { type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { log, type Logger } from './loggerCore';

const UIPathContext = createContext<string>('');

// React's `type` on an element can be a string (host), a function component,
// or a wrapper object (forwardRef → { render }, memo → { type }, plus an
// optional `displayName`). Treating it as `unknown` and narrowing through
// this shape replaces a small pile of `as any` casts with a single, audited
// access path (audit 56 F-014).
type ReactComponentLike = {
  displayName?: unknown;
  name?: unknown;
  type?: unknown;
  render?: unknown;
};

function asComponentLike(t: unknown): ReactComponentLike | null {
  return t && typeof t === 'object' ? (t as ReactComponentLike) : null;
}

function readStringField(o: ReactComponentLike | null, key: 'displayName' | 'name'): string | null {
  const v = o?.[key];
  return typeof v === 'string' ? v : null;
}

function extractVisibleContent(node: ReactNode, depth: number = 0, maxDepth: number = 6): string[] {
  try {
    if (depth > maxDepth) return [];
    if (node == null || typeof node === 'boolean') return [];
    if (typeof node === 'string') return node.trim() ? [node.trim()] : [];
    if (typeof node === 'number') return [String(node)];
    if (Array.isArray(node))
      return node.flatMap((n) => extractVisibleContent(n, depth + 1, maxDepth));

    if (!React.isValidElement(node)) return [];

    const { type, props } = node as React.ReactElement<Record<string, unknown>>;
    if (!props) return [];
    const hints: string[] = [];

    if (typeof type === 'string') {
      const ax = typeof props.accessibilityLabel === 'string' ? props.accessibilityLabel : null;
      const ph = typeof props.placeholder === 'string' ? props.placeholder : null;
      if (ax) hints.push(`[${type}:${ax}]`);
      if (ph) hints.push(`[${type}:${ph}]`);
    } else {
      const typeObj = asComponentLike(type);
      const resolved = typeof type === 'function' ? type : (typeObj?.type ?? typeObj?.render);
      const resolvedObj = asComponentLike(resolved);
      const name =
        readStringField(typeObj, 'displayName') ??
        readStringField(resolvedObj, 'displayName') ??
        (typeof resolved === 'function' ? resolved.name : null) ??
        'Anon';
      const descProps: string[] = [];
      if (typeof props.title === 'string') descProps.push(`title='${props.title}'`);
      if (typeof props.label === 'string') descProps.push(`label='${props.label}'`);
      if (typeof props.name === 'string') descProps.push(`name='${props.name}'`);
      hints.push(`<${name}${descProps.length ? ' ' + descProps.join(' ') : ''}>`);
    }

    if (props.children !== undefined) {
      hints.push(...extractVisibleContent(props.children as ReactNode, depth + 1, maxDepth));
    }

    return hints;
  } catch {
    return [];
  }
}

interface LogProps {
  /** Component name — used as the log path and correlation key */
  name: string;
  children: ReactNode;
  /** Logger instance. Defaults to the global `log` */
  logger?: Logger;
  /** Style for a wrapper View. Only renders a View when provided. */
  style?: StyleProp<ViewStyle>;
  /**
   * Optional testID for the screen container. When omitted and `name`
   * ends with `Screen`, a `screen-<kebab>` testID is auto-derived (e.g.
   * `MintQuoteScreen` → `screen-mint-quote`). The testID is rendered as
   * a hidden 1×1 transparent <Text> element in the AX tree so log-doctor
   * can target it via `wait for screen #screen-mint-quote` etc. without
   * any layout impact.
   */
  testID?: string;
}

/**
 * Convert a `<Log name="...">` value to a screen-* testID. Returns
 * undefined when the name doesn't look like a screen — we don't want
 * to pollute the AX tree with `screen-background-view` etc. for the
 * non-screen Log usages.
 */
function deriveScreenTestID(name: string): string | undefined {
  if (!name.endsWith('Screen')) return undefined;
  const stem = name.slice(0, -'Screen'.length);
  if (stem.length === 0) return undefined;
  const kebab = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return `screen-${kebab}`;
}

/**
 * Wrap any visual component in <Log name="..."> to automatically log
 * the visible content tree on mount and diffs on re-render.
 *
 * Nests: a <Log> inside another <Log> produces paths like "ParentScreen/ChildCard".
 *
 * - With style prop: renders a <View style={style}> wrapper.
 * - Without style: layout-invisible (just a context provider). Safe inside
 *   ScrollViews, ModalLayoutWrappers, etc.
 */
export function Log({
  name,
  children,
  logger: _logger,
  style,
  testID,
}: LogProps): React.ReactElement {
  const parentPath = useContext(UIPathContext);
  const path = parentPath ? `${parentPath}/${name}` : name;
  const screenLogger = _logger ?? log;

  const prevContentKey = useRef<string | undefined>(undefined);
  const prevContent = useRef<string[]>([]);

  useEffect(() => {
    try {
      const content = extractVisibleContent(children);
      const contentKey = content.join('|');
      if (prevContentKey.current === undefined) {
        screenLogger.debug('ui.screen', { screen: path, content });
      } else if (contentKey !== prevContentKey.current) {
        const prevSet = new Set(prevContent.current);
        const currSet = new Set(content);
        const removed = prevContent.current.filter((c) => !currSet.has(c));
        const added = content.filter((c) => !prevSet.has(c));
        if (removed.length > 0 || added.length > 0) {
          screenLogger.debug('ui.screen.diff', { screen: path, removed, added });
        }
      }
      prevContentKey.current = contentKey;
      prevContent.current = content;
    } catch {
      /* extractVisibleContent failed — skip content logging, don't break the app */
    }
  });

  const resolvedTestID = testID ?? deriveScreenTestID(name);

  // When a testID is set, wrap children in a View carrying the testID so
  // log-doctor's snapshot machinery can root subtree captures there. The
  // default `flex: 1` style makes the wrapper fill its parent; an explicit
  // `style` prop overrides it.
  if (resolvedTestID) {
    const { View } = require('react-native');
    return React.createElement(
      UIPathContext.Provider,
      { value: path },
      React.createElement(
        View,
        {
          testID: resolvedTestID,
          accessible: false,
          style: style ?? { flex: 1 },
        },
        children
      )
    );
  }

  if (style) {
    const { View } = require('react-native');
    return React.createElement(
      UIPathContext.Provider,
      { value: path },
      React.createElement(View, { style }, children)
    );
  }
  return React.createElement(UIPathContext.Provider, { value: path }, children);
}
