/**
 * Offline hardening for the pre-existing recovery-custody prototype. This is
 * not a live custody design or approval to export recovery material. If the
 * prototype is exercised by unit tests, its raw value stays out of the public
 * ledger and its restricted file must validate before an intent is recorded.
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { Secret, type SecretKind } from '../core/redact';
import { durableReplaceFile, durableUnlinkFile, ensurePrivateDirectory } from './durable';

export interface CustodyHandle {
  id: string;
  kind: SecretKind;
  len: number;
  fingerprint: string;
}

const custodyDir = (base: string) => join(base, 'custody');
const fp = (raw: string) => createHash('sha256').update(raw).digest('hex');

const validHandleShape = (handle: CustodyHandle): boolean =>
  /^[0-9a-f]{16}$/.test(handle.id) &&
  /^[0-9a-f]{12}$/.test(handle.fingerprint) &&
  Number.isSafeInteger(handle.len) &&
  handle.len > 0;

const secretPath = (base: string, handle: CustodyHandle): string => {
  if (!validHandleShape(handle)) throw new Error('invalid custody handle');
  return join(custodyDir(base), `${handle.id}.secret`);
};

function validatedRaw(base: string, handle: CustodyHandle): string {
  const path = secretPath(base, handle);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(`custody missing for handle ${handle.id}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`custody is not a regular file for handle ${handle.id}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`custody permissions are unsafe for handle ${handle.id}`);
  }
  const raw = readFileSync(path, 'utf8');
  if (raw.length !== handle.len) throw new Error(`custody length mismatch for ${handle.id}`);
  const digest = fp(raw);
  if (digest.slice(0, 16) !== handle.id || digest.slice(0, 12) !== handle.fingerprint) {
    throw new Error(`custody fingerprint mismatch for ${handle.id}`);
  }
  return raw;
}

/** Persist recovery material; returns a handle carrying NO raw value. */
export function storeRecovery(base: string, kind: SecretKind, raw: string): CustodyHandle {
  const dir = custodyDir(base);
  ensurePrivateDirectory(dir);
  const digest = fp(raw);
  const id = digest.slice(0, 16);
  const handle: CustodyHandle = { id, kind, len: raw.length, fingerprint: digest.slice(0, 12) };
  const path = join(dir, `${id}.secret`);
  durableReplaceFile(path, raw);
  // public sidecar (metadata only) so custody presence is auditable without the raw
  durableReplaceFile(join(dir, `${id}.json`), JSON.stringify(handle));
  return handle;
}

export const hasCustody = (base: string, handle: CustodyHandle): boolean => {
  try {
    validatedRaw(base, handle);
    return true;
  } catch {
    return false;
  }
};

/** Reveal the stored recovery material as a typed Secret (crash-recovery only). */
export function loadRecovery(base: string, handle: CustodyHandle): Secret {
  return new Secret(handle.kind, validatedRaw(base, handle));
}

/** Remove reconciled recovery material and its public metadata sidecar. The
 * caller must prove reconciliation first; this low-level primitive deliberately
 * performs no ledger inference. */
export function deleteRecovery(base: string, handle: CustodyHandle): void {
  validatedRaw(base, handle);
  const path = secretPath(base, handle);
  durableUnlinkFile(path);
  const sidecar = join(custodyDir(base), `${handle.id}.json`);
  if (existsSync(sidecar)) durableUnlinkFile(sidecar);
}
