# App catalog services

The app reads wallpaper and merchant catalogs from Nagg's `app` module using
`backendConfig.scoreApiBaseUrl`. This defaults to the configured Nostr app-view
host, with an independent score-host override when needed. No generic Nostr
query endpoint is required for these catalogs.

| Endpoint | Response contract | App cache owner |
| --- | --- | --- |
| `GET /app/wallpapers` | Existing shared `CatalogResponse`: `wallpapers`, `albums`, `lastUpdated` | `wallpaperStore` / `wallpaperSync` |
| `GET /app/btcmap/places` | Existing shared `BtcMapPlacesResponse` array | `btcMapStore`, one-hour freshness |
| `GET /app/btcmap/places/{id}` | Existing shared `BtcMapPlaceDetails` object, including `osm:*` fields | `btcMapStore`, 24-hour freshness |

The shared parsers accept additional upstream fields. Catalog and list parsing
strip unknown fields; merchant details preserve them. Malformed required fields
remain errors. A failed wallpaper refresh preserves the persisted catalog,
albums, downloaded files, and last successful fetch timestamp. A failed merchant
list refresh serves cached places, even when expired, without advancing their
timestamp. Detail refresh failures remain errors and preserve existing cache
entries. Persisted schemas and versions are unchanged by this routing migration.

The backend counterpart owns relay ingestion, refresh scheduling, response
caching, upstream field selection, and BTC Map filtering. The app does not
replicate that proxy. The specified older proxy checkout was unavailable during
this migration; compatibility was checked against the installed shared schemas
and the local Nagg counterpart's source. Deployment and live upstream availability
still require backend integration verification.

Mint audit discovery uses `GET /nostr/mint/discover?mint=<encoded-url>` on the
same score host. Unlike the app catalogs, this requires Nagg's `nostr` module.
`apiClient.discoverMint` parses the same loose row as bulk discovery and returns
no row when `mints` is empty. `getDiscoveredMintMetadata` checks the shared
`mintMetadataStore` audit freshness first, then writes misses through
`upsertFromDiscover`; failures preserve cached data. Recovery continues to use
bulk `discoverMints()`.

Discovery audit fields include state, operation counts, `uptime24h`,
`avgLatencyMs`, `auditSource`, and `auditUpdatedAt`. The last four are tolerant
optional persisted fields; older cache rows remain valid. Upstream timestamps
are retained verbatim, separate from the local fetch timestamp. The operation
score is successes / (successes + errors), scaled to five; absent counts or no
operations leave it unknown. Unknown mints have no new audit fields. A direct
NUT-06 info lookup remains available when operator identity is missing.

The former audit HTTP client, runtime parser, and separate backend host setting
are retired. Legacy cached audit blobs remain readable, including their swap
observations; discovery aggregates cannot supply route edges. Rebalance routing
uses retained observations and local swap history, with existing quality and
trust checks. Metadata TTL and audit health are never spendability evidence.
The deployed single-mint route could not be reached from this implementation
environment; local regression fixtures cover the supplied discovery contract.
