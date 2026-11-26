// ---------------------------------------------------------------------------
// Lightning payment target from a Nostr profile (kind-0 `lud16` / `lud06`)
//
// One place decides which published field is a payable Lightning target, so
// the profile screen and the contact-send entry cannot disagree about it.
// ---------------------------------------------------------------------------

import { decodeLnurlBech32, parseLightningAddress } from "./lnurl";

/** Trim, drop a leading `lightning:` scheme, and keep it only if payable. */
function clean(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  value = value.replace(/^lightning:/i, "").trim();
  if (!value) return null;
  if (parseLightningAddress(value)) return value;
  if (decodeLnurlBech32(value)) return value;
  return null;
}

/**
 * The Lightning target a profile published, or null. `lud16` wins over
 * `lud06`; each accepts a Lightning address (tags like `user+tag@host` are
 * fine) or an `lnurl1…` string. An unusable `lud16` falls through to `lud06`.
 */
export function extractLightningTarget(profile: {
  lud16?: string | null;
  lud06?: string | null;
}): string | null {
  return clean(profile.lud16) ?? clean(profile.lud06);
}
