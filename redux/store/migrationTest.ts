import { Proof } from '@cashu/cashu-ts';

const id = 0;
const mnemonic = undefined; //'crumble stamp weapon meadow tilt logic winter mean tooth bracket wool fire';

export const nostrState = {
  profiles: [
    {
      id,
      mnemonic,
    },
  ],
  currentProfile: {
    id,
    mnemonic,
  },
};

const mintAToken = undefined; //'';
type DecodedToken = { mint: string; proofs: Proof[] };
const decodedMintAToken: DecodedToken | undefined = undefined; //getDecodedToken(mintAToken);

// Extract values to avoid TypeScript narrowing issues
// Use explicit type guard to help TypeScript
let mintUrl: string | undefined = undefined;
let proofs: Proof[] | undefined = undefined;
if (decodedMintAToken !== undefined && decodedMintAToken !== null) {
  const token: DecodedToken = decodedMintAToken;
  mintUrl = token.mint;
  proofs = token.proofs;
}

export const cashuState = {
  selectedMint: mintUrl,
  profiles: {
    counters:
      mintUrl && proofs
        ? {
            [mintUrl]: Object.fromEntries(proofs.map((proof: Proof) => [proof.id, 100])),
          }
        : {},
    proofs:
      mintUrl && proofs
        ? {
            [mintUrl]: proofs,
          }
        : {},
  },
};
