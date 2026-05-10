# `internal:` custom icon namespace

Brand and product-specific glyphs that are bundled into the Monicon registry alongside Iconify icons. Reference them at runtime as `<Icon name="internal:<filename>" />`.

## Adding a new icon

1. Drop a single `<svg viewBox="0 0 W H">…</svg>` file into this directory. Name it `<glyph>.svg` (the filename, minus extension, becomes the `internal:` suffix).
2. Use `fill="currentColor"` (and/or `stroke="currentColor"`) on every path so the runtime `color` prop flows through.
3. Run `node scripts/regenerate-icons.js`. The script scans this directory automatically — no need to list the icon anywhere else.
4. Reference it: `<Icon name="internal:<glyph>" size={20} color={...} />`.

## Authoring rules

- One `<svg>` root per file, with an explicit `viewBox`.
- No external `<image>`, `<style>`, or font references — the runtime renders these as static SVG, not a full DOM.
- Multi-color or gradient icons need to stay as `react-native-svg` components (see the currency icons in `../index.tsx`); the registry's flat-string body format only carries shape data with a single colorable fill/stroke.

See [`__rules__/icons.md`](../../../__rules__/icons.md) for when to add to this namespace vs reach for an Iconify glyph.
