#!/usr/bin/env node
/**
 * Generate a giveaway P2PK keypair for Sovran.
 *
 * The SECRET goes into `.env` (gitignored) as GIVEAWAY_P2PK_SECRET and into the
 * EAS environment; app.config.js injects it into `extra.giveawayP2pkSecret` for
 * every build profile, and shared/lib/cashu/manager.ts hands it to the coco
 * P2PK import plugin so any install can redeem ecash locked to its PUBLIC key.
 *
 * SECURITY: a key embedded in the app bundle is extractable by anyone who
 * reverse-engineers a build, so "only our app can unlock" is best-effort. Only
 * lock LOW-VALUE, rotatable giveaways to this key. See
 * skills/sovran-security/references/secure-storage-key-derivation.md.
 *
 * Usage:  node scripts/gen-giveaway-key.mjs
 */
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const sk = generateSecretKey();
const pkHex = getPublicKey(sk);
const nsec = nip19.nsecEncode(sk);
const npub = nip19.npubEncode(pkHex);
const skHex = Buffer.from(sk).toString('hex');

process.stdout.write(
  [
    '',
    'Generated a giveaway P2PK keypair.',
    '',
    'SECRET — add to .env (gitignored) and EAS, never commit:',
    '',
    `  GIVEAWAY_P2PK_SECRET=${nsec}`,
    `  # or hex: ${skHex}`,
    '',
    'PUBLIC key — lock giveaway tokens to this (safe to publish):',
    '',
    `  npub:   ${npub}`,
    `  pubkey: ${pkHex}`,
    '',
    'EAS (production):',
    '',
    `  eas env:create --name GIVEAWAY_P2PK_SECRET --value '${nsec}' --visibility secret --environment production`,
    '',
    '',
  ].join('\n')
);
