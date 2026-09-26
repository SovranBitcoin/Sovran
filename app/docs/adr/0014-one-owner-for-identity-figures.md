# One owner for a Nostr identity's figures, fed by every nagg route

Date: 2026-09-26
Status: Accepted; device check of the cross-links outstanding.

## Context

Reputation (Vertex score) and reach (follower count) showed a dash on most
rows — search, the mint and provider selectors, the mint and provider pages,
the profile page. The causes were structural, not a single fetch failure:

- nagg spelled an operator six ways (`providers[pk].vertex` + aggregates on
  profile routes, flat `operatorPubkey/followers/vertexScore` on discovery,
  `pubkey/followers` and no score on the provider directory, `{name,picture}`
  maps elsewhere), and returned nowhere the mints or providers an npub runs.
- The app kept counts in the entity cache's profile stats but no reputation;
  search hits were never cached; a Vertex refresh spread `followers: null`
  over painted counts; the provider list replaced a profile with the
  directory's count instead of merging; a discovery row marked social data
  fresh without a score; every profile-hook mount started with `score: null`.
- Vertex only scores accounts with ~500 followers, so most operators have a
  count and no score. That one is a fact, not a bug, and stays a dash.

## Decision

**nagg** (`v2`, `docs/appview-api.md` § Identities) attaches one typed
`identities[<hex>]` group — `profile`, `reach {followers, follows, source}`,
`vertex {rank, score, fetchedAt}`, `operates {mints, aiProviders}`,
`firstEventAt` — to every route that names a pubkey: profile, search,
recommended, mint discover, mint reviews, mint info (plus a per-row
`operatorPubkey`) and the AI provider directory. `null` means unresolved,
never 0. Existing fields stay for older app builds.

**The app** keeps one owner: the entity cache's profile stats
(`facade.CachedProfileStats`) now hold score, rank, Vertex fetch time and what
the pubkey operates. Every nagg route writes there — search hits at the data
layer, mint reviews in the facade, the REST profile / discovery / mint info /
provider directory in their fetchers via `cacheIdentities`. A figure a source
could not measure never erases one another source knew (`mergeSearchHit`,
`keepCounts`, `setSocial`). `ContactRow` reads the cache as its last fallback
through `useCachedProfileStats`, which peeks at the layer rather than
building it, so a list row does no config work.

`OperatorRunsSection` renders `operates` on the profile, mint and provider
pages so the three link to each other through the operator.

## Consequences

- A score or count seen anywhere is the one shown everywhere; a fresh
  profile page paints the reputation the search list showed.
- `@nostr-dev-kit/ndk-mobile` is stubbed once for Jest through
  `moduleNameMapper` (`app/__mocks__/ndkMobile.ts`); per-suite `virtual`
  mocks of it no longer take effect.
- `@sovranbitcoin/schemas` still mirrors the api.sovran.money-era shapes;
  `NaggIdentitySchema` lives in `nostr/src/envelope.ts` until the shared
  package gains a nagg module.
- Accounts below Vertex's floor keep a reputation dash beside a real count.
