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

The remaining audit migration is a prerequisite for removing the separate
backend configuration: `apiClient.auditMint()` still calls `/cashu/mint/audit`
on this task's base. The inspected Nagg checkout exposes mint discovery, reviews,
history, and changes, but no equivalent per-mint audit response. Preserve this
caller until its replacement route and schema, or the sibling migration commit,
are available. Recovery already consumes `discoverMints()`.
