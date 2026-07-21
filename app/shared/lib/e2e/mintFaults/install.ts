/**
 * Side-effect installer for e2e mint-fault injection, imported from
 * app/index.js so the fetch patch exists before any module can issue a mint
 * request (coco resolves the global fetch at call time, so only order
 * relative to the first request matters — this is trivially earliest).
 *
 * Fail-closed: without the harness-owned EXPO_PUBLIC_E2E_MINT_FAULTS env (or
 * in production/web) this module does nothing at all.
 */
import { isMintFaultInjectionEnabled, mintFaultLaunchRuleSetRaw } from './enabled';
import { mintFaultEngine } from './engine';
import { installMintFaultFetchInterceptor } from './interceptor';
import { startMintFaultIo } from './io';
import { parseMintFaultRuleSet } from './rules';

export function installMintFaults(): void {
  if (!isMintFaultInjectionEnabled()) return;
  const raw = mintFaultLaunchRuleSetRaw();
  if (raw) {
    try {
      mintFaultEngine.loadRuleSet(parseMintFaultRuleSet(raw));
    } catch {
      // A malformed launch rule set arms the interceptor with zero rules
      // rather than crashing the app under test; the harness's revision ack
      // will catch the mismatch.
    }
  }
  installMintFaultFetchInterceptor();
  startMintFaultIo();
}

installMintFaults();
