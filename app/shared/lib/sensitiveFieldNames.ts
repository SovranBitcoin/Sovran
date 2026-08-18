/**
 * @fileoverview Canonical vocabulary for "which field names hold secrets".
 *
 * Two redaction paths consume this: the scoped logger (`loggerCore`) and the
 * Settings → "Share Full Dump" exporter (`debug/storageInventory`). They each
 * carried a private copy of the same list, and the copies drifted — the dump
 * path never learned about `token`/`authorization`, and the two disagreed on
 * which bucket `xpriv` belongs to. A field one path redacts and the other
 * prints is a leak, so the list lives here once.
 *
 * Callers keep their own presentation: the logger brands a value
 * `{ _kind: 'private_key' }`, the dump writes `<REDACTED:private-key>`.
 */

/** `private-key` = raw key material; `secret` = recovery phrases and bearer credentials. */
type SensitiveFieldKind = 'private-key' | 'secret';

/** Strip separators/casing so `private_key`, `privateKey` and `private-key` all match. */
function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Classify a field name, or `null` when it is not sensitive.
 *
 * Matching is on the normalized name only — never the value — so a caller can
 * decide to redact before it has looked at what it is about to print.
 */
export function sensitiveFieldKind(fieldName: string): SensitiveFieldKind | null {
  const normalized = normalizeFieldName(fieldName);
  if (
    normalized === 'secret' ||
    normalized === 'nsec' ||
    normalized.endsWith('nsec') ||
    normalized === 'privkey' ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('privatekeyhex') ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('signerkey') ||
    // An extended private key is key material, not a recovery phrase — the
    // logger used to bucket this as `secret` and the dump as `private-key`.
    normalized.endsWith('xpriv')
  ) {
    return 'private-key';
  }
  if (
    normalized === 'mnemonic' ||
    normalized.endsWith('mnemonic') ||
    normalized === 'seed' ||
    normalized.endsWith('seed') ||
    normalized.endsWith('seedhex') ||
    normalized.endsWith('passphrase') ||
    normalized.endsWith('password')
  ) {
    return 'secret';
  }
  // Bearer credentials. Previously logger-only, so a `…token` /
  // `…authorization` field survived the storage dump in the clear unless its
  // value happened to match one of the bearer-instrument value patterns.
  if (
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'authorization' ||
    normalized.endsWith('authorization')
  ) {
    return 'secret';
  }
  return null;
}
