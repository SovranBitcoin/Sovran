/**
 * Fresh payment roots must clear app-side routing state before asking Colada
 * to start a new flow. This source-level symmetry guard intentionally covers
 * the few root callbacks spread across otherwise expensive screen trees.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(APP_ROOT, '..');

function readSource(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

function expectBefore(source: string, first: string, second: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second, firstIndex + first.length);

  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

describe('fresh payment-root context clearing', () => {
  it.each([
    {
      file: 'app/features/user/screens/UserProfileScreen.tsx',
      clear: "clearPaymentContext('user.profile.send_money')",
      start: 'machine.startSendEcash({',
    },
    {
      file: 'app/features/user/screens/UserMessagesScreen.tsx',
      clear: "clearPaymentContext('user.messages.send_money')",
      start: '(machine as SendMoneyPaymentMachine).startSendEcash({',
    },
    {
      file: 'app/features/feed/components/nostr/NoteContent.tsx',
      clear: "clearPaymentContext('feed.lightning_invoice')",
      start: 'machine.execute(meltTarget, { reset: true })',
    },
    {
      // Preset zap path: clear before booking the amount into the machine.
      file: 'app/features/feed/hooks/useZap.ts',
      clear: "clearPaymentContext('feed.zap_post')",
      start: 'machine.enterAmount(',
    },
    {
      // Custom zap path: clear before entering the send flow.
      file: 'app/features/feed/hooks/useZap.ts',
      clear: "clearPaymentContext('feed.zap_post')",
      start: 'machine.startSendEcash({',
    },
  ])('$file clears stale routing state before starting Colada', ({ file, clear, start }) => {
    expectBefore(readSource(file), clear, start);
  });

  it('owns deep-link context clearing in the app without importing app stores into wallet', () => {
    const appProvider = readSource('app/features/send/providers/Colada.tsx');
    const walletProvider = readSource('wallet/src/react/ColadaProvider.tsx');
    const deepLinkEffect = walletProvider.slice(walletProvider.indexOf('deepLink.scan.start'));

    expect(appProvider).toContain("onBeforeScan: () => clearPaymentContext('send.deeplink')");
    expectBefore(
      deepLinkEffect,
      'deepLinks.onBeforeScan?.();',
      'machineRef.current.scan(host, { source: "deeplink" })'
    );
    expect(walletProvider).not.toContain('@/shared/stores/runtime/clearPaymentContext');
  });
});
