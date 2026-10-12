Where does key material trace back to a narrow or guessable input rather than a full-width read from an approved entropy source?

Find where seeds, private keys, secrets, nonces and blinding factors are created, and follow each
back to its input. The concern is an input that ends at a timestamp, counter, device or install
id, user PIN, single 32-bit draw, or a truncated, sliced, modulo'd, Number()-converted or base-36
part of a wider value. Hashing, stretching, or a non-cryptographic PRNG seeded from it (Mersenne
Twister, seedrandom, xorshift, mulberry32, chance, faker) adds length, not entropy. BIP-32
derivation, HKDF and passphrase stretching over an already-wide root are expansion by design.
Approved sources are crypto.getRandomValues, expo-crypto, @noble/hashes randomBytes and the
helpers that wrap it.
