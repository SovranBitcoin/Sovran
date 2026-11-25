import { cloneElement, isValidElement, type ElementType, type ReactNode } from 'react';

/**
 * Hands `props` to every element of one of `types` inside `children`,
 * searching nested children too, so a compound component's parts read their
 * parent's state without a context. Elements with nothing to inject are
 * returned as they are.
 */
export function injectParts(children: ReactNode, types: ElementType[], props: object): ReactNode {
  const visit = (node: ReactNode): ReactNode => {
    if (Array.isArray(node)) {
      const next = node.map(visit);
      return next.some((item, index) => item !== node[index]) ? next : node;
    }
    if (!isValidElement(node)) return node;
    if (types.includes(node.type as ElementType)) return cloneElement(node, props);
    const nested = (node.props as { children?: ReactNode }).children;
    if (nested == null || typeof nested === 'function') return node;
    const next = visit(nested);
    return next === nested ? node : cloneElement(node, undefined, next);
  };
  return visit(children);
}
