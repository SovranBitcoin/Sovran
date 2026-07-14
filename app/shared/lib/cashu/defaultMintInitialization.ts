export interface TrustedMintInitializer {
  isTrustedMint(mintUrl: string): Promise<boolean>;
  addMint(mintUrl: string, options: { trusted: true }): Promise<unknown>;
}

export interface EnsureTrustedMintResult {
  status: 'already-trusted' | 'added';
  attempts: number;
}

interface EnsureTrustedMintOptions {
  attempts?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 750;
// Coco's mint HTTP layer has no abort/timeout hook, so a mint that accepts the
// TCP connection but never responds would hang an attempt forever — and with
// it CocoProvider Phase 2, which must reach enableNpcSyncAndProcessor or paid
// mint quotes are never detected. The race below bounds each attempt instead.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;

const delay = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

async function raceAttemptTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`default mint attempt timed out after ${timeoutMs}ms`);
          error.name = 'TimeoutError';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Idempotently trusts one curated default mint, retrying only after a complete
 * failed attempt. A late first attempt is observed through `isTrustedMint` on
 * the next pass (that also makes abandoning a timed-out attempt safe), and no
 * fallback ever marks an unverified mint as trusted.
 */
export async function ensureTrustedDefaultMint(
  mint: TrustedMintInitializer,
  mintUrl: string,
  options: EnsureTrustedMintOptions = {}
): Promise<EnsureTrustedMintResult> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const sleep = options.sleep ?? delay;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('default mint initialization requires at least one attempt');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await raceAttemptTimeout(async () => {
        if (await mint.isTrustedMint(mintUrl)) {
          return { status: 'already-trusted' as const, attempts: attempt };
        }
        await mint.addMint(mintUrl, { trusted: true });
        return { status: 'added' as const, attempts: attempt };
      }, attemptTimeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('default mint initialization failed');
}
