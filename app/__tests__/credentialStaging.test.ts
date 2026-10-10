/** @jest-environment node */
import { createCredentialStaging } from '@/shared/lib/cashu/credentialStaging';

/**
 * The rule that keeps one account's wallet from being opened with another's
 * credentials when a closing wallet and an opening one overlap.
 */
const key = (fill: number) => new Uint8Array(32).fill(fill);

it('captures everything staged at one moment, and later stages do not change it', () => {
  const staging = createCredentialStaging();
  staging.stageAccount(2, true);
  staging.stageWalletPhrase('phrase a');
  staging.stageSigner(key(1));

  const captured = staging.capture();
  staging.stageAccount(5, false);
  staging.stageWalletPhrase('phrase b');
  staging.stageSigner(key(2));

  expect(captured).toEqual({
    accountIndex: 2,
    isImported: true,
    cashuMnemonic: 'phrase a',
    signerKey: key(1),
  });
});

it('keeps its own copy of the signer key', () => {
  const staging = createCredentialStaging();
  const handedOver = key(7);
  staging.stageSigner(handedOver);
  handedOver.fill(0);

  expect(staging.signerKey).toEqual(key(7));
  // And a capture is a copy too: zeroing it leaves the staged key intact.
  staging.capture().signerKey?.fill(0);
  expect(staging.signerKey).toEqual(key(7));
});

it('clears everything secret when nothing was staged since the snapshot', () => {
  const staging = createCredentialStaging();
  staging.stageAccount(3, true);
  staging.stageWalletPhrase('phrase a');
  staging.stageSigner(key(1));

  staging.clearUnchangedSince(staging.revisions());

  expect(staging.cashuMnemonic).toBeNull();
  expect(staging.signerKey).toBeNull();
  expect(staging.isImported).toBe(false);
  // The index names a database; it is not a secret and is not cleared.
  expect(staging.accountIndex).toBe(3);
});

it('leaves each credential that was staged again, and only those', () => {
  const staging = createCredentialStaging();
  staging.stageAccount(0, false);
  staging.stageWalletPhrase('phrase a');
  staging.stageSigner(key(1));
  const closing = staging.revisions();

  // The next account stages its account and phrase, but no signer key.
  staging.stageAccount(4, true);
  staging.stageWalletPhrase('phrase b');
  staging.clearUnchangedSince(closing);

  expect(staging.accountIndex).toBe(4);
  expect(staging.isImported).toBe(true);
  expect(staging.cashuMnemonic).toBe('phrase b');
  // Account a's key must not be inherited by account b.
  expect(staging.signerKey).toBeNull();
});

it('treats staging the same value again as a new stage', () => {
  const staging = createCredentialStaging();
  staging.stageWalletPhrase('same phrase');
  const closing = staging.revisions();
  staging.stageWalletPhrase('same phrase');

  staging.clearUnchangedSince(closing);

  expect(staging.cashuMnemonic).toBe('same phrase');
});

it('clears unconditionally without a snapshot', () => {
  const staging = createCredentialStaging();
  staging.stageWalletPhrase('phrase');
  staging.stageSigner(key(1));

  staging.clearUnchangedSince();

  expect(staging.cashuMnemonic).toBeNull();
  expect(staging.signerKey).toBeNull();
});
