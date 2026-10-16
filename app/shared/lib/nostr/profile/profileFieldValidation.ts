import { parseNip05Identifier } from 'wallet';
import { LightningAddress } from '@sovranbitcoin/schemas';

/**
 * Sanity checks for the free-text kind-0 fields the editor exposes. Both
 * addresses share the `local@domain` shape and a lowercase, ASCII local part:
 *
 * - LUD-16 (Lightning address): `<username>@<domain>`, username `a-z0-9-_.`,
 *   resolved at `https://<domain>/.well-known/lnurlp/<username>`.
 * - NIP-05 (Nostr address): `<local-part>@<domain>`, local part `a-z0-9-_.`
 *   (case-insensitive, stored lowercase); `_@<domain>` is the root name and a
 *   bare domain is shorthand for it.
 *
 * These are syntax checks. Changed NIP-05 claims must also pass the
 * publisher's fresh domain-to-key verification before signing.
 */
export type ProfileFieldCheck = { ok: true; value: string } | { ok: false; message: string };

const LOCAL_PART = /^[a-z0-9._-]+$/;
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

function splitAddress(value: string): { local: string; domain: string } | null {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  return { local: value.slice(0, at), domain: value.slice(at + 1) };
}

export function checkLud16(input: string): ProfileFieldCheck {
  const value = input.trim().toLowerCase();
  if (!value) return { ok: true, value: '' };
  const parts = splitAddress(value);
  if (!parts || !LOCAL_PART.test(parts.local) || !DOMAIN.test(parts.domain))
    return { ok: false, message: 'Enter a Lightning address like name@domain.com.' };
  if (!LightningAddress.safeParse(value).success)
    return { ok: false, message: 'Enter a Lightning address like name@domain.com.' };
  return { ok: true, value };
}

export function checkNip05(input: string): ProfileFieldCheck {
  const value = input.trim().toLowerCase();
  if (!value) return { ok: true, value: '' };
  const parsed = parseNip05Identifier(value);
  return parsed
    ? { ok: true, value: parsed.identifier }
    : { ok: false, message: 'Enter a Nostr address like name@domain.com.' };
}

export const ABOUT_MAX_LENGTH = 500;

export function checkAbout(input: string): ProfileFieldCheck {
  const value = input.trim();
  if (value.length > ABOUT_MAX_LENGTH)
    return { ok: false, message: `Keep it under ${ABOUT_MAX_LENGTH} characters.` };
  return { ok: true, value };
}
