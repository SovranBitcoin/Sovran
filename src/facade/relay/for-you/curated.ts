// ---------------------------------------------------------------------------
// Cold-start curated seed
//
// When the viewer has no likes of their own, For-You bootstraps from the likes
// of a small set of well-known, high-signal Bitcoin/Nostr accounts: we pool
// THEIR reactions (the "melting pot") to discover candidate authors. This is a
// seed, not an allow-list — none of these accounts are guaranteed to appear in
// the feed; only the authors they collectively like do.
//
// TODO(product): confirm this list and each hex pubkey before ship. Names are
// the intent; the hex values must be verified (a wrong key = a wrong account).
// ---------------------------------------------------------------------------

export const CURATED_FOR_YOU_PUBKEYS: readonly string[] = [
  '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // jack
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d', // fiatjaf
  '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55 (William Casarin)
  '50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63', // Calle (cashu)
  '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
  '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
  'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
  'e88a691e98d9987c964521dff60025f60700378a4879180dcbbb4a5027850411', // NVK
  '460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c', // Vitor Pamplona
  '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross
];
