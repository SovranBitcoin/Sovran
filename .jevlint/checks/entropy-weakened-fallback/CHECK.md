Where can key material be produced from something other than an approved entropy source without failing loudly?

Key material: seed entropy, private keys, proof secrets, blinding factors, nonces, bunker secrets,
pairing codes, auth tokens. Approved sources: crypto.getRandomValues, expo-crypto, randomBytes from
@noble/hashes/utils and the @scure and nostr-tools helpers that wrap it, and the installed Coco and
cashu-ts packages for the secrets they own. Find each entropy read and any fallback around it that
still returns bytes: a ?? or || default, a try/catch, a typeof, platform or availability branch,
an optional chain, a polyfill, shim or injected generator. A fallback that throws, returns an
error result or refuses to produce the value is correct.
