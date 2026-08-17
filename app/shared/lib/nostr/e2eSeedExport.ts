type SeedExportFetch = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, 'ok' | 'status'>>;

interface E2ESeedExportOptions {
  enabled?: boolean;
  endpoint?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: SeedExportFetch;
}

const TOKEN = /^[0-9a-f]{64}$/;

function assertOwnedLoopbackEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/seed' ||
    url.search ||
    url.hash
  ) {
    throw new Error('invalid funded E2E seed-export endpoint');
  }
}

/** DEV-only mnemonic handoff to the runner's authenticated loopback server.
 * The phrase is request-body data, never a console/log payload. A normal dev
 * session has neither environment value and returns without touching fetch. */
export async function maybeExportSeedForE2E(
  mnemonic: string,
  options: E2ESeedExportOptions = {}
): Promise<void> {
  const enabled = options.enabled ?? __DEV__;
  if (!enabled) return;
  const endpoint = options.endpoint ?? process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT;
  const token = options.token ?? process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN;
  if (!endpoint && !token) return;
  if (!endpoint || !token || !TOKEN.test(token)) {
    throw new Error('invalid funded E2E seed-export configuration');
  }
  assertOwnedLoopbackEndpoint(endpoint);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const fetchImpl =
      options.fetchImpl ??
      // eslint-disable-next-line no-restricted-properties -- authenticated one-shot loopback IPC returns only HTTP status
      globalThis.fetch;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-sovran-e2e-token': token,
      },
      body: mnemonic,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`funded E2E seed export failed with HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
