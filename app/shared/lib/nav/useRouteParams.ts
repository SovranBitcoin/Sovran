import { useEffect, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type { ZodType, infer as zInfer } from 'zod';
import { loggableIssues } from '@sovranbitcoin/schemas';
import { log } from '@/shared/lib/logger';

type LoggableIssue = ReturnType<typeof loggableIssues>[number];

export interface UseRouteParamsOptions {
  /** Short identifier for log lines, e.g. `'user-flow.bitchatDM'`. */
  where: string;
  /**
   * Behaviour when the params fail validation. Defaults to `'back'`, which
   * dispatches `router.back()` from a stable effect. Pass a callback to
   * handle the failure manually (e.g. show a toast and navigate elsewhere);
   * the callback is fired exactly once per invalid render.
   */
  onInvalid?: 'back' | ((issues: LoggableIssue[]) => void);
}

/**
 * Validate `useLocalSearchParams()` against a Zod schema once at the route
 * boundary. Deep-link params are attacker-controllable per AUDIT.md dim-5,
 * and TypeScript narrowing on `useLocalSearchParams<{...}>()` is compile-time
 * only. Routes must reject malformed input before any downstream consumer
 * sees it.
 *
 * Returns `z.infer<S>` on success and `null` on failure. Callers should
 * `return null` (or render a loading shell) when the result is null so the
 * downstream tree never observes invalid input.
 *
 * On failure the hook logs `nav.<where>.invalid_params` (PII-safe via
 * `loggableIssues`) and dispatches `onInvalid` from a `useEffect`. Effects
 * are used so React strict-mode double-invokes never fight `router.back()`.
 */
export function useRouteParams<S extends ZodType>(
  schema: S,
  options: UseRouteParamsOptions
): zInfer<S> | null {
  const raw = useLocalSearchParams();
  const parsed = useMemo(() => schema.safeParse(raw), [schema, raw]);

  useEffect(() => {
    if (parsed.success) return;
    const issues = loggableIssues({
      type: 'schema/zod',
      where: options.where,
      issues: parsed.error.issues,
    });
    log.warn(`nav.${options.where}.invalid_params`, { issues });
    const policy = options.onInvalid ?? 'back';
    if (policy === 'back') {
      router.back();
    } else {
      policy(issues);
    }
  }, [parsed, options.where, options.onInvalid]);

  return parsed.success ? parsed.data : null;
}
