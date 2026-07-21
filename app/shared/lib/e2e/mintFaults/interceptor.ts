/**
 * E2e-only global fetch interceptor for mint-fault injection.
 *
 * All app-side mint HTTP funnels through coco's RequestRateLimiter, which
 * calls the global `fetch` at call time — coco's request provider is not
 * injectable through any public CocoConfig seam (Manager hardcodes it), so
 * this patch is the one choke point that reaches every mint request. Rules
 * are mint-URL-scoped (wildcard rules require a `/v1/` cashu path), so
 * api.sovran.money, relays, blossom, and the harness's loopback IPC always
 * pass through untouched. A matched request never reaches the network.
 *
 * Future upstream: once CocoConfig grows a mintRequestProvider/fetch option,
 * this becomes constructor injection and the globalThis patch disappears.
 */
import { mintFaultEngine, type MintFaultDecision } from './engine';
import type { MintFaultResponse } from './rules';

/** Timeout-mode requests with no caller AbortSignal still settle eventually. */
const TIMEOUT_HARD_CAP_MS = 600_000;

let installed = false;

/** In-flight signal-less timeout fakes, rejected on every rule swap so a
 * cleared rule unblocks the app deterministically instead of hanging. */
const pendingTimeoutRejects = new Set<() => void>();

export function rejectPendingTimeoutFakes(): void {
  for (const reject of [...pendingTimeoutRejects]) reject();
  pendingTimeoutRejects.clear();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function jsonResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function executeFault(
  response: MintFaultResponse,
  delayMs: number | undefined,
  signal: AbortSignal | null | undefined
): Promise<Response> {
  if (delayMs) await sleep(delayMs);
  switch (response.mode) {
    case 'error':
      return jsonResponse(
        JSON.stringify({ code: response.code, detail: response.detail }),
        response.status
      );
    case 'httpStatus':
      return jsonResponse(response.body, response.status);
    case 'malformed':
      return jsonResponse('{"broken":', 200);
    case 'offline':
      // RN's exact network-failure shape → coco NetworkError → colada offline.
      throw new TypeError('Network request failed');
    case 'timeout': {
      if (response.afterMs !== undefined) {
        await sleep(response.afterMs);
        throw abortError();
      }
      return new Promise<Response>((_resolve, reject) => {
        const settle = () => {
          clearTimeout(cap);
          pendingTimeoutRejects.delete(settle);
          reject(abortError());
        };
        const cap = setTimeout(settle, TIMEOUT_HARD_CAP_MS);
        pendingTimeoutRejects.add(settle);
        if (signal) {
          if (signal.aborted) {
            settle();
            return;
          }
          signal.addEventListener('abort', settle, { once: true });
        }
      });
    }
  }
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string') {
    return (input as { url: string }).url;
  }
  return '';
}

function requestMethod(input: unknown, init: { method?: string } | undefined): string {
  if (init?.method) return init.method;
  if (
    input &&
    typeof input === 'object' &&
    typeof (input as { method?: unknown }).method === 'string'
  ) {
    return (input as { method: string }).method;
  }
  return 'GET';
}

/**
 * Patch the global fetch. Callers gate on isMintFaultInjectionEnabled();
 * idempotent so a double import can never stack wrappers.
 */
export function installMintFaultFetchInterceptor(): void {
  if (installed) return;
  installed = true;
  mintFaultEngine.addOnRulesSwapped(rejectPendingTimeoutFakes);
  // eslint-disable-next-line no-restricted-properties -- e2e mint-fault seam over the raw fetch coco calls (see offlineReachability precedent)
  const realFetch = globalThis.fetch.bind(globalThis);
  const patched = async (input: unknown, init?: RequestInit): Promise<Response> => {
    let decision: MintFaultDecision | null = null;
    if (mintFaultEngine.hasRules()) {
      decision = mintFaultEngine.decide(requestUrl(input), requestMethod(input, init));
    }
    if (!decision?.apply) {
      return realFetch(input as Parameters<typeof fetch>[0], init);
    }
    return executeFault(decision.rule.response, decision.rule.delayMs, init?.signal);
  };
  // eslint-disable-next-line no-restricted-properties -- e2e mint-fault seam (installed only under the fail-closed enabled gate)
  globalThis.fetch = patched as typeof fetch;
}
