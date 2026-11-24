# Mint health comes from several auditors; mint history is kept on the phone

Accepted on 2026-11-24.

The auditor registry already lists NIP-87, MintRadar, the Cashu Auditor
(`api.audit.8333.space`) and IMF.gg. The mint-changes history Mint Info links to came from
nagg, which no longer serves it, so a person deciding whether to hold money at a mint sees
no record of how its info has changed.

Two auditors are added. `auditor.ucash.space` is on by default.
`auditor.regtest.macadamia.cash` is an opt-in toggle, and each mint it reports is
classified as test or mainnet per mint, so a test mint never reads as a healthy real one.
The `imf.gg` adapter is fixed to read its snake_case fields and to follow pagination; it
currently requests only `?page=1`.

Each source's result is stored as its own typed observation in `mintMetadataStore`, added
beside the existing fields with defaults and no version bump, so an older install's saved
metadata still parses. Mint Info's StatsGrid shows four metrics drawn from them: 24h
Uptime, Operation Success, Probe Latency and Operations Sampled, each labelled with its
source. Beneath it, pills show the mint's NUT capabilities and its `input_fee_ppk`.

Mint history moves to a profile-scoped `mint-history-store` on the phone. For each mint it
keeps one canonical NUT-06 info document as a baseline and up to 20 revisions, each an
invertible RFC 6902 diff, so any earlier version can be rebuilt. At most 64 mints are kept,
least recently viewed dropped first (wallet mints evicted last). Observations record on
every direct `/v1/info` fetch and Coco refresh, plus a bounded passive background sweep on
login/foreground (at most once per 24h per trusted mint, concurrency 3, exponential backoff
on failure).
