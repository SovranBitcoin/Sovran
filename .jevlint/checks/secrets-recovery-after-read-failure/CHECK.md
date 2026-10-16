Where can a locked, failed or invalid secure-storage read lead to generating or overwriting recovery material?

Find every place a mnemonic, seed or private key is generated or written, the secure-storage read
that precedes it, and what the failure branch of that read does. A locked or unreadable store does
not mean a seed is absent, and existing but invalid mnemonic material must not be overwritten.
ensureMnemonicExists in app/shared/lib/nostr/secureStorage.ts separates those outcomes before
generation. Generation after confirmed absence is correct.
