interface ProfileSwitchResource<T> {
  value: T;
  stop: () => Promise<void>;
  release: () => void;
}

/** A revocable service handle: stop admission, drain calls, then release its target. */
export function profileSwitchResource<T extends object>(
  target: T,
  nestedKeys: readonly PropertyKey[] = []
): ProfileSwitchResource<T> {
  let stopped = false;
  const pending = new Set<Promise<unknown>>();
  const nested = new Map<PropertyKey, ProfileSwitchResource<object>>();
  const { proxy, revoke } = Proxy.revocable(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key, object);
      if (value && typeof value === 'object' && nestedKeys.includes(key)) {
        let resource = nested.get(key);
        if (!resource) {
          if (stopped) throw new Error('Profile service stopped');
          resource = profileSwitchResource(value);
          nested.set(key, resource);
        }
        return resource.value;
      }
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (stopped && !['off', 'removeListener', 'removeAllListeners'].includes(String(key)))
          throw new Error('Profile service stopped');
        const result: unknown = Reflect.apply(value, object, args);
        if (result instanceof Promise) {
          pending.add(result);
          void result.then(
            () => pending.delete(result),
            () => pending.delete(result)
          );
        }
        if (
          result &&
          typeof result === 'object' &&
          !(result instanceof Promise) &&
          nestedKeys.includes(key)
        ) {
          const resource = profileSwitchResource(result);
          nested.set(Symbol(), resource);
          return resource.value;
        }
        return result === object ? proxy : result;
      };
    },
  });
  return {
    value: proxy,
    async stop(): Promise<void> {
      stopped = true;
      await Promise.all([...nested.values()].map((resource) => resource.stop()));
      await Promise.allSettled([...pending]);
    },
    release: () => {
      for (const resource of nested.values()) resource.release();
      nested.clear();
      revoke();
    },
  };
}
