// ---------------------------------------------------------------------------
// P2PK — what a proof's spending conditions say, and who can satisfy them.
//
// `secret.ts` parses the NUT-10 envelope and compares keys; `conditions.ts`
// turns a whole token's worth of those into the one model every surface reads
// (the pending-send screen, the timeline, the cancel rule). Keeping both
// behind this barrel means a caller can never pick up half the vocabulary.
// ---------------------------------------------------------------------------

export * from "./secret";
export * from "./conditions";
export * from "./lock";
