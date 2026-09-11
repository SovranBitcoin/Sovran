# Sovran feature graphics

- [Google Play / Android — 1024×500 PNG](generated/android/1024x500.png)
- [iPhone companion — 1024×500 PNG](generated/ios/1024x500.png)

The banner uses a charcoal `#0e0e0e` ground with a soft spotlight behind the
hero phone, the white Sovran lockup and Mona Sans typography. The left column
holds the lockup, a two-line ExtraBold headline (“Pay in bitcoin.” / “Chat on
Nostr.”) and a two-line Medium subtitle (“Payments, conversations / and AI in
one app.”), centred as one block with a 344px measure.

The right two thirds are a staggered stack of four framed phones drawn back to
front: AI chat, contacts, Lightning receive, then the wallet as the hero. Each
phone steps down and forward, grows in size, casts a blurred shadow onto the one
behind it, and the rear phones are progressively dimmed so the eye lands on the
wallet balance. Every phone runs off the bottom edge (a 64px floor fade settles
the base) and the hero stays inside a 28px right-hand safe margin so Play's
overlays and crops do not clip it. Frames are a thin dark bezel with a
top-lit rim highlight; screenshots keep their native aspect ratio inside a
rounded screen clip. Phones stay upright; no rotation, gold, badges or panel
labels. The composition JSON owns the copy, palette, and per-platform phone
slots (`x`, `top`, `width`, `dim`, listed back to front).

The feed capture was excluded because its photo prominently contains third-party
characters. The phone frames are generic bezels, not a branded device; no store
badge, ranking, pricing or endorsement claim is added. The layout follows Google
Play's guidance: one focal point, large legible copy, and nothing critical near
the edges.

## Rebuild

From the repository root or `app/`:

```sh
bun run assets:feature
bun run assets:feature:check
```

The main `assets:generate` and `assets:check` commands include these graphics.
The generator is `scripts/feature-graphic.mjs`; no network, simulator or installed
system font is needed. Both outputs are 1024×500, sRGB, three-channel PNGs without
alpha, comfortably below 15 MB. These are local exports; nothing is uploaded.
The iPhone file is a companion promotional banner, not an Apple screenshot slot.
Use the Android file in Google Play.

## True sources

`source/composition.json` chooses four screenshots from each requested run and
records their SHA-256 hashes and provenance. Platform directory names are `android` and `ios`; named files use lowercase
kebab-case. `source/screenshots/<platform>/` contains `wallet.png`, `contacts.png`,
`lightning-receive.png` and `ai-chat.png`, without run-order prefixes.
`generated/<platform>/1024x500.png` is the uploadable output. Manifest paths are
relative to the feature-graphic directory. The eight source PNGs are exact
copies of those selected exports, retained so deleting ignored e2e runs cannot
break regeneration. These captures contain demonstration data. Refresh the files
and their hashes deliberately when the UI or demo content changes; do not
silently pick a different latest run.

The generator trims system bars, frames each screenshot at its native aspect
ratio, outlines bundled Mona Sans, and places the canonical lockup by its ink
bounds. It
renders at twice the final size and downsamples once for smooth text and panel edges.
No intermediate SVG or duplicate logo master is stored here. Existing brand
masters and fonts remain the true branding inputs. The three archived Group SVG
exports were removed at the user's request; canonical S/wordmark masters remain.

The generator rejects changed screenshot bytes, invalid font paths, copy wider
than its column, phones outside the safe area or not bleeding off the bottom,
incorrect sizes, alpha channels, excessive file sizes and stale output. Both final graphics
were visually inspected at native size, including the complete copy block,
phone overlap and platform-specific UI. `generated/manifest.json` records output hashes/sizes.

Requirements reference: [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB).

Suggested alt text (under 140 characters):

> Sovran: a stack of phones showing the bitcoin wallet, contacts, a Lightning receive and AI chat on a charcoal background.
