import { apiLog } from '../logger';
import { checkBalance, topUpBalance } from './api';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

interface TopUpResult {
  success: true;
  balance: number;
  isNewWallet: boolean;
}

interface TopUpFailure {
  success: false;
  error: unknown;
}

/**
 * Orchestrates the Routstr wallet creation / top-up flow.
 *
 * - If an API key exists → top up the existing wallet.
 * - If no API key → try creating a wallet from the token.
 *   - If the endpoint is unavailable (404) → use the token as the API key.
 * - Always verify the balance via `checkBalance` afterwards.
 *
 * Updates the routstrStore with the resulting apiKey and balance.
 */
export async function executeRoutstrTopUp(
  encodedToken: string
): Promise<TopUpResult | TopUpFailure> {
  const store = useRoutstrStore.getState();
  const currentApiKey = store.apiKey;
  let apiKey = currentApiKey;
  let isNewWallet = false;
  const start = performance.now();

  apiLog.info('routstr.topup.start', { hasApiKey: !!currentApiKey });

  try {
    if (apiKey) {
      apiLog.debug('routstr.topup.path', { strategy: 'existing_wallet' });
      const topUpStart = performance.now();
      const { added_amount } = await topUpBalance({ apiKey, cashuToken: encodedToken });
      apiLog.debug('routstr.topup.topup_call_done', {
        addedMsats: added_amount,
        duration_ms: Math.round(performance.now() - topUpStart),
      });
      // A 200 that credits nothing is a silent loss: the token has left the
      // wallet and the node kept it without raising. `TopUpSpine` makes `msats`
      // optional (nodes have changed this field's spelling before), so a
      // response the app cannot read parses cleanly as zero — which is exactly
      // the case that must not be reported as success.
      if (!(added_amount > 0)) {
        throw new Error('Routstr accepted the token but credited nothing');
      }
    } else {
      apiKey = encodedToken;
      isNewWallet = true;
      store.setApiKey(apiKey);
      apiLog.info('routstr.topup.using_token_as_key', { tokenLength: encodedToken.length });
    }

    // Verify balance
    apiLog.debug('routstr.topup.verify_balance_start');
    const balanceStart = performance.now();
    let balanceResult = await checkBalance(apiKey);
    apiLog.debug('routstr.topup.verify_balance_done', {
      balance: balanceResult.balance,
      duration_ms: Math.round(performance.now() - balanceStart),
    });

    // Server may return a persistent api_key — prefer it, but never inherit the
    // OLD credential's balance. `sk-<hash>` and the raw Cashu token address the
    // same account row on a healthy node, so the second read should agree; if
    // it does not, the figure the UI gates sends against would be a lie about a
    // wallet the app can no longer reach, and every send would 402 while the
    // pill showed funds. Re-read, and keep the credential that actually
    // answered if the upgrade cannot be verified.
    if (balanceResult.api_key && balanceResult.api_key !== apiKey) {
      const previousKey = apiKey;
      try {
        const upgraded = await checkBalance(balanceResult.api_key);
        apiKey = balanceResult.api_key;
        balanceResult = { ...upgraded, api_key: balanceResult.api_key };
        store.setApiKey(apiKey);
        apiLog.info('routstr.topup.api_key_upgraded', {
          reason: 'server_returned_persistent_key',
          balance: upgraded.balance,
        });
      } catch (upgradeError) {
        apiLog.warn('routstr.topup.api_key_upgrade_rejected', {
          error: upgradeError instanceof Error ? upgradeError.message : String(upgradeError),
        });
        apiKey = previousKey;
      }
    }

    store.setBalance(balanceResult.balance);
    apiLog.info('routstr.topup.success', {
      balance: balanceResult.balance,
      isNewWallet,
      total_ms: Math.round(performance.now() - start),
    });

    return { success: true, balance: balanceResult.balance, isNewWallet };
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'error' in error
        ? (error as { error: { message: string } }).error.message
        : error instanceof Error
          ? error.message
          : 'Top-up failed';
    apiLog.error('routstr.topup.failed', {
      error: message,
      duration_ms: Math.round(performance.now() - start),
    });

    // Still store the apiKey if we managed to set one (partial success)
    if (apiKey && !currentApiKey) {
      apiLog.warn('routstr.topup.partial_success', { reason: 'api_key_set_but_balance_failed' });
      store.setApiKey(apiKey);
    }

    return { success: false, error };
  }
}

/** Format a msats balance for display. */
export function formatRoutstrBalance(msats: number): string {
  if (msats >= 1000) {
    const sats = Math.floor(msats / 1000);
    return `${sats.toLocaleString()} sats`;
  }
  return `${msats} msats`;
}
