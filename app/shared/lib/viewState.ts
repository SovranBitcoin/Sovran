/**
 * What an async surface can be showing, as one value instead of a handful of
 * booleans (`isLoading`, `error`, `data.length === 0`) whose combinations
 * nobody checks. Render it with `<StateSwitch>` or `matchViewState`, both of
 * which make every state a required branch.
 *
 * - `loading`: nothing to show yet; the skeleton.
 * - `empty`: loaded, and there is nothing.
 * - `error`: nothing to show because loading failed.
 * - `ready`: the data.
 * - `refreshing`: the data, while a newer copy loads.
 * - `stale`: the data, known to be out of date (offline, or a refresh failed).
 *
 * The last three carry the same `data`, so a surface keeps showing it (and
 * `<StateSwitch>` keeps the same component mounted) as it moves between them.
 */

export type ViewState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'refreshing'; readonly data: T }
  | { readonly status: 'stale'; readonly data: T; readonly error?: unknown };

export type ViewStatus = ViewState<unknown>['status'];

/** The states that hold data, which a surface renders through one component. */
export type ViewStateWithData<T> = Extract<ViewState<T>, { data: T }>;

export interface ViewStateHandlers<T, R> {
  loading: () => R;
  empty: () => R;
  error: (error: unknown) => R;
  ready: (data: T) => R;
  refreshing: (data: T) => R;
  stale: (data: T, error: unknown) => R;
}

/** Compile-time proof a switch covered every case; throws if one slips past at runtime. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/** Calls the handler for `state`'s status; every status needs one. */
export function matchViewState<T, R>(state: ViewState<T>, handlers: ViewStateHandlers<T, R>): R {
  switch (state.status) {
    case 'loading':
      return handlers.loading();
    case 'empty':
      return handlers.empty();
    case 'error':
      return handlers.error(state.error);
    case 'ready':
      return handlers.ready(state.data);
    case 'refreshing':
      return handlers.refreshing(state.data);
    case 'stale':
      return handlers.stale(state.data, state.error);
    default:
      return assertNever(state, 'Unknown view state');
  }
}

/** The data a state holds, or undefined for `loading`, `empty` and `error`. */
export function viewStateData<T>(state: ViewState<T>): T | undefined {
  return hasViewStateData(state) ? state.data : undefined;
}

export function hasViewStateData<T>(state: ViewState<T>): state is ViewStateWithData<T> {
  return state.status === 'ready' || state.status === 'refreshing' || state.status === 'stale';
}

/**
 * Derives a state from the flags a hook usually returns. Data wins over the
 * flags: a surface that already shows something keeps showing it while it
 * reloads (`refreshing`) or after a failed reload (`stale`), and only an
 * empty first load shows the skeleton.
 */
export function toViewState<T>({
  data,
  isLoading = false,
  error,
  isEmpty = defaultIsEmpty,
  stale = false,
}: {
  /** Undefined while nothing has loaded. */
  data: T | undefined | null;
  isLoading?: boolean;
  /** Set when the last load failed. */
  error?: unknown;
  /** Whether loaded `data` counts as nothing; defaults to an empty array. */
  isEmpty?: (data: T) => boolean;
  /** The data is known to be out of date (for example offline). */
  stale?: boolean;
}): ViewState<T> {
  const loaded = data !== undefined && data !== null;
  if (loaded && !isEmpty(data)) {
    if (error !== undefined && error !== null) return { status: 'stale', data, error };
    if (stale) return { status: 'stale', data };
    return isLoading ? { status: 'refreshing', data } : { status: 'ready', data };
  }
  if (isLoading) return { status: 'loading' };
  if (error !== undefined && error !== null) return { status: 'error', error };
  return loaded ? { status: 'empty' } : { status: 'loading' };
}

function defaultIsEmpty(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}
