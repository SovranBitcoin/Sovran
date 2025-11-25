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
const decodedMintAToken = undefined; //getDecodedToken(mintAToken);

export const cashuState = {
  selectedMint: decodedMintAToken?.mint,
  profiles: {
    counters: {
      [decodedMintAToken?.mint]: decodedMintAToken
        ? {
          ...Object.fromEntries(decodedMintAToken?.proofs.map((proof: Proof) => [proof.id, 100])),
        }
        : {},
    },
    proofs: {
      [decodedMintAToken?.mint]: decodedMintAToken ? decodedMintAToken?.proofs : {},
    },
  },
};
