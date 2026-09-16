import { createRequire } from 'node:module';
import { buildSourceCatalog, readSourceFile, readCaptureSource, sha256 } from './source-catalog.mjs';
import { BACKGROUNDS, DEFAULT_BRAND, validateRecipe, resolveCapture } from './composition-recipe.mjs';
import { createScene, renderPhone, SCENE_PRESETS } from '../../scripts/lib/phone-frame.mjs';

const rendererRequire = createRequire(import.meta.url);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
let runtime;
async function renderingRuntime() {
  // Public static builds never resolve the root's native raster/font dependencies.
  runtime ??= Promise.all(['sharp', 'opentype.js'].map(name => import(rendererRequire.resolve(name))));
  const [sharp, opentype] = await runtime;
  return { sharp: sharp.default, opentype: opentype.default };
}

/** The published lockup, rasterized from the approved brand SVG and measured by
 * its ink so an anchor means the visible logo, not its padded canvas. */
async function brandWatermark(catalog, repoRoot, sharp, { lockup, scale }, background, unit) {
  const layout = lockup === 'symbol' ? 'symbol' : 'wordmark-lockup';
  const theme = background === 'paper' ? 'black-on-transparent' : 'white-on-transparent';
  const logo = catalog.logos.find(item => item.layout === layout && item.theme === theme);
  const output = logo?.outputs.find(item => item.format === 'svg');
  if (!logo?.viewBox || !logo.bounds?.length || !output) throw new Error(`Brand ${layout}/${theme} is unavailable. Run bun run assets:brand, then render again.`);
  const bytes = await readSourceFile(repoRoot, output.file);
  if (sha256(bytes) !== output.sha256) throw new Error('Brand artwork changed during render. Refresh and try again.');
  const [, , boxWidth, boxHeight] = logo.viewBox;
  const left = Math.min(...logo.bounds.map(bound => bound.x));
  const top = Math.min(...logo.bounds.map(bound => bound.y));
  const inkWidth = Math.max(...logo.bounds.map(bound => bound.x + bound.width)) - left;
  const inkHeight = Math.max(...logo.bounds.map(bound => bound.y + bound.height)) - top;
  if (!(inkWidth > 0 && inkHeight > 0 && boxWidth > 0 && boxHeight > 0)) throw new Error('Brand artwork has no measurable ink.');
  const factor = (unit * 0.047 * scale) / inkHeight;
  const pixels = Math.max(1, Math.round(boxWidth * factor * 2));
  const density = Math.min(2400, Math.max(1, Math.round((72 * pixels) / boxWidth)));
  const png = await sharp(bytes, { density }).resize(pixels, Math.max(1, Math.round(boxHeight * factor * 2)), { fit: 'fill' }).png().toBuffer();
  return { href: `data:image/png;base64,${png.toString('base64')}`, width: boxWidth * factor, height: boxHeight * factor,
    inkX: left * factor, inkY: top * factor, inkWidth: inkWidth * factor, inkHeight: inkHeight * factor };
}

/** Render approved source bytes in memory. Throws on invalid, missing or non-opted-in
 * outdated captures. No filesystem writes; PNG is always rasterized from returned SVG.
 * Optional recipe.draft=true permits outdated/unverified sources with a visible label.
 *
 * A publishable render carries the brand lockup and nothing else: capture
 * provenance belongs in the returned metadata, not burned into an image people
 * see. Only a draft keeps a visible label, because that is what makes it
 * unpublishable. */
export async function renderComposition(input, { repoRoot } = {}) {
  const recipe = validateRecipe(input);
  if (!repoRoot) throw new Error('repoRoot is required.');
  const catalog = await buildSourceCatalog(repoRoot);
  const sources = recipe.phones.map(phone => {
    const capture = resolveCapture(catalog, phone.captureId);
    if (!capture?.available) throw new Error(`Capture unavailable: ${phone.captureId}. No image was substituted.`);
    if (capture.freshness !== 'current' && !recipe.draft) throw new Error(`Capture ${phone.captureId} is ${capture.freshness}. Explicitly enable draft to render.`);
    return capture;
  });
  const { sharp, opentype } = await renderingRuntime();
  const fonts = {};
  for (const weight of ['ExtraBold', 'Medium']) {
    const bytes = await readSourceFile(repoRoot, `app/assets/fonts/MonaSans/MonaSans-${weight}.ttf`);
    fonts[weight] = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  const embedded = [];
  for (const capture of sources) {
    const bytes = await readCaptureSource(repoRoot, capture);
    if (sha256(bytes) !== capture.sha256) throw new Error('Capture changed during render. Refresh and try again.');
    embedded.push(`data:image/png;base64,${bytes.toString('base64')}`);
  }
  const poses = recipe.phones.some(phone => phone.pose) ? recipe.phones.map((phone, i) => ({ ...SCENE_PRESETS[recipe.preset].poses[i], ...phone.pose })) : undefined;
  const scene = createScene(sources.map((source, i) => ({ key: source.id, width: source.width, height: source.height, frameId: recipe.phones[i].frameId })), { preset: recipe.preset, poses });
  if (poses) {
    // Keep the authored camera when shrinking/moving a phone, rather than fitting
    // away the edit. Expand only as necessary to keep the full chassis visible.
    const baseline = createScene(sources.map(source => ({ key: source.id, width: source.width, height: source.height })), { preset: recipe.preset });
    const x = Math.min(scene.x, baseline.x), y = Math.min(scene.y, baseline.y);
    scene.viewBox = `${x} ${y} ${Math.max(scene.x + scene.width, baseline.x + baseline.width) - x} ${Math.max(scene.y + scene.height, baseline.y + baseline.height) - y}`;
  }
  const { width, height } = recipe;
  const wide = width / height >= 1.5;
  const unit = Math.min(width, height);
  const margin = unit * 0.055;
  const ink = recipe.background === 'paper' ? '#171916' : '#f5f7f2';
  const textWidth = wide ? width * 0.39 : width - margin * 2;
  const draft = Boolean(recipe.draft);
  const brand = { ...DEFAULT_BRAND, ...(recipe.brand ?? {}) };
  const mark = brand.placement === 'none' ? undefined : await brandWatermark(catalog, repoRoot, sharp, brand, recipe.background, unit);
  // The watermark and any draft badge own a reserved band, so copy and phones
  // are laid out inside what is left rather than on top of the logo.
  const bandHeight = Math.max(mark?.inkHeight ?? 0, draft ? unit * 0.03 : 0);
  const band = bandHeight ? bandHeight + margin * 0.75 : 0;
  const atTop = mark ? brand.placement.startsWith('top') : false;
  const topBand = atTop ? band : 0;
  const bottomBand = band - topBand;
  const disclosure = draft ? 'DRAFT - capture freshness not verified for publication' : 'App-source matched - native build freshness unverified';
  // disclosure describes the render; imageLabel is what the viewer actually sees,
  // and a publishable image shows none of it.
  const provenance = { version: 1, recipe, recipeSha256: sha256(JSON.stringify(recipe)), draft,
    disclosure, imageLabel: draft ? disclosure : null, brand, appSourceFingerprint: catalog.fingerprint,
    captures: sources.map((source, i) => ({ captureId: recipe.phones[i].captureId, canonicalId: source.id, source: source.source,
      sha256: source.sha256, freshness: source.freshness, evidenceClass: source.evidenceClass, captureEvidence: source.captureEvidence,
      functionalResult: source.functionalResult, publicationEligibility: source.publicationEligibility, publicationReview: source.publicationReview,
      frameId: recipe.phones[i].frameId ?? source.frameId, capturedAt: source.capturedAt, run: source.run, nativeBuild: source.nativeBuild })) };
  const outline = (value, font, size, x, y) => {
    if ([...value].some(char => !/\s/.test(char) && !font.charToGlyphIndex(char))) throw new Error('Copy contains a glyph not supported by the bundled font.');
    const d = font.getPath(value, 0, 0, 1000, { kerning: true }).toPathData({ decimalPlaces: 3, flipY: false });
    if (/NaN|Infinity/.test(d)) throw new Error('Invalid text outline.');
    return `<path d="${d}" fill="${ink}" transform="translate(${x} ${y}) scale(${size / 1000})"/>`;
  };
  const wrap = (value, font, size, maxWidth, maxLines) => {
    const result = [];
    let line = '';
    for (const word of value.trim().split(/\s+/).filter(Boolean)) {
      if (font.getAdvanceWidth(word, size) > maxWidth) return { tooWide: true };
      const next = line ? `${line} ${word}` : word;
      if (font.getAdvanceWidth(next, size) > maxWidth) { result.push(line); line = word; } else line = next;
    }
    if (line) result.push(line);
    return result.length > maxLines ? { tooMany: true } : { lines: result };
  };
  // Set at the display size the poster pipeline used, and step down only as far
  // as the copy needs — long copy shrinks itself instead of making every image small.
  const fit = (value, font, preferred, maxWidth, maxLines) => {
    let last = wrap(value, font, preferred, maxWidth, maxLines);
    for (let size = preferred; size >= preferred * 0.6; size *= 0.94) {
      last = wrap(value, font, size, maxWidth, maxLines);
      if (last.lines) return { lines: last.lines, size };
    }
    throw new Error(last.tooWide ? 'A word is too wide. Shorten the copy or change the canvas.'
      : 'Copy does not fit. Shorten it or choose a wider canvas.');
  };
  const headingFit = fit(recipe.headline, fonts.ExtraBold, unit * 0.072, textWidth, wide ? 5 : 3);
  const titleSize = headingFit.size;
  const heading = headingFit.lines;
  const subtitleFit = fit(recipe.subtitle, fonts.Medium, Math.min(unit * 0.028, titleSize * 0.46), textWidth, 4);
  const subtitleSize = subtitleFit.size;
  const subtitle = subtitleFit.lines;
  let y = topBand + (wide ? height * 0.26 : margin + titleSize);
  const copy = [];
  for (const line of heading) { copy.push(outline(line, fonts.ExtraBold, titleSize, margin, y)); y += titleSize * 1.14; }
  y += subtitleSize * 0.7;
  for (const line of subtitle) { copy.push(outline(line, fonts.Medium, subtitleSize, margin, y)); y += subtitleSize * 1.4; }
  // The band's baseline: the logo sits on it, and a draft badge shares it from
  // the opposite side so neither can land on top of the other.
  const bandY = atTop ? margin : height - margin - bandHeight;
  const anchors = { left: margin, center: (width - (mark?.inkWidth ?? 0)) / 2, right: width - margin - (mark?.inkWidth ?? 0) };
  const side = mark ? brand.placement.split('-')[1] : 'center';
  const logo = mark
    ? `<image x="${(anchors[side] ?? margin) - mark.inkX}" y="${bandY + (bandHeight - mark.inkHeight) / 2 - mark.inkY}" width="${mark.width}" height="${mark.height}" href="${mark.href}" aria-hidden="true"/>`
    : '';
  let badge = '';
  if (draft) {
    // A centred logo leaves two gutters; an anchored one leaves the rest of the band.
    const room = !mark ? width - 2 * margin
      : side === 'center' ? (width - mark.inkWidth) / 2 - margin * 1.5
        : width - 2 * margin - mark.inkWidth - margin * 0.75;
    if (room <= 0) throw new Error('The canvas is too narrow for a labelled draft beside the logo.');
    const size = Math.min(width * 0.019, 20, room / fonts.Medium.getAdvanceWidth(disclosure, 1));
    const badgeWidth = fonts.Medium.getAdvanceWidth(disclosure, size);
    const badgeX = mark && side === 'left' ? width - margin - badgeWidth : margin;
    badge = outline(disclosure, fonts.Medium, size, badgeX, bandY + bandHeight * 0.75);
  }
  const boxTop = wide ? margin + topBand : y + margin * 0.45;
  const box = wide ? { x: width * 0.46, y: boxTop, width: width * 0.54 - margin, height: height - margin * 2 - band }
    : { x: margin, y: boxTop, width: width - 2 * margin, height: height - boxTop - margin * 0.9 - bottomBand };
  if (box.height < height * 0.3 || y > height - margin * 2 - bottomBand) throw new Error('Copy leaves too little room for phones. Shorten it.');
  const phoneSvg = scene.phones.map(phone => renderPhone(phone, { id: `phone-${phone.index}`, href: embedded[phone.index], alt: sources[phone.index].title })).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${escape(recipe.title)}</title><metadata>${escape(JSON.stringify(provenance))}</metadata><rect width="${width}" height="${height}" fill="${BACKGROUNDS[recipe.background]}"/>${copy.join('')}<svg x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" viewBox="${scene.viewBox}" preserveAspectRatio="xMidYMid meet">${phoneSvg}</svg>${logo}${badge}</svg>`;
  const png = await sharp(Buffer.from(svg), { limitInputPixels: 5_000_000 }).timeout({ seconds: 30 }).png().toBuffer();
  if (png.length > 24 * 1024 * 1024) throw new Error('Rendered image exceeds byte limit.');
  return { png, svg, provenance };
}
