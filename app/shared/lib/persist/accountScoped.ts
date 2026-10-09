/**
 * Module-level holders of per-account state: caches, Maps and singletons that
 * live outside React and outside any store, so remounting the account
 * providers does not reach them. Each registers how to drop what it holds.
 * See ADR 0029.
 */
interface AccountScopedHolder {
  name: string;
  dispose: () => void | Promise<void>;
}

export const accountScopedHolders: AccountScopedHolder[] = [];

/**
 * Record teardown capability; registration never invokes it. Holders that
 * share a name are all kept (one per instance), so register a holder that is
 * rebuilt per session once, at module level, not each time it is rebuilt.
 * Provider-owned instances unregister after teardown so dead closures do not accumulate.
 */
export function registerAccountScoped(
  name: string,
  dispose: () => void | Promise<void>
): () => void {
  const holder = { name, dispose };
  accountScopedHolders.push(holder);
  return () => {
    const index = accountScopedHolders.indexOf(holder);
    if (index !== -1) accountScopedHolders.splice(index, 1);
  };
}
