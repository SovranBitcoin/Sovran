interface NavState {
  type?: string;
  routes: { state?: unknown }[];
}

/**
 * Whether any stack in a navigation state, at any depth, has something on top
 * of its first route: a sheet, a modal or a pushed screen.
 */
export function hasPresentedRoutes(state: unknown): boolean {
  if (!state || typeof state !== 'object' || !Array.isArray((state as NavState).routes)) {
    return false;
  }
  const { type, routes } = state as NavState;
  if (type === 'stack' && routes.length > 1) return true;
  return routes.some((route) => hasPresentedRoutes(route.state));
}

/**
 * Run `start` unless a run is already in flight, in which case join it. The
 * slot is cleared when the run settles, so a later call starts again.
 */
export function joinOrStart(
  slot: { current: Promise<void> | null },
  start: () => Promise<void>
): Promise<void> {
  if (slot.current) return slot.current;
  const run = start().finally(() => {
    if (slot.current === run) slot.current = null;
  });
  slot.current = run;
  return run;
}
