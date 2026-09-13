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
 * Neither is resolved over the network here — a typo that still parses is
 * the user's to catch; an unparsable value must never be published.
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
  // A bare domain is the root identifier `_@domain` (NIP-05).
  const parts = splitAddress(value) ?? (DOMAIN.test(value) ? { local: '_', domain: value } : null);
  if (!parts || !LOCAL_PART.test(parts.local) || !DOMAIN.test(parts.domain))
    return { ok: false, message: 'Enter a Nostr address like name@domain.com.' };
  return { ok: true, value: `${parts.local}@${parts.domain}` };
}

export const ABOUT_MAX_LENGTH = 500;

export function checkAbout(input: string): ProfileFieldCheck {
  const value = input.trim();
  if (value.length > ABOUT_MAX_LENGTH)
    return { ok: false, message: `Keep it under ${ABOUT_MAX_LENGTH} characters.` };
  return { ok: true, value };
}
