# Sovran docs

The Sovran documentation site, built with [VitePress](https://vitepress.dev).

## Develop

Run from the repository root (the Bun workspace root):

```bash
bun install            # install the workspace
bun run docs:dev       # start the local dev server
bun run docs:build     # static build → docs/.vitepress/dist
bun run docs:preview   # preview the production build
```

The same scripts are available inside this package (`bun run docs:dev` etc.).

## Layout

- `.vitepress/config.ts` — site config (title, nav, sidebar, base via `DOCS_BASE`).
- `.vitepress/theme/` — default VitePress theme + a small `custom.css` brand override.
- `index.md` — home page.
- `starting/`, `wallet/`, `payments/`, `protocols/`, `offline/`, `architecture/`,
  `reference/` — content sections.

## Editing

Content reorganizes claims from the app `README.md` (the source of truth for
product claims) and documents how the app actually consumes the `wallet` and
`nostr` packages. Don't add new product claims here — keep this site in step with
what the app ships. The app's ADRs live separately under `app/docs/adr/`.
