import { createRequire } from 'node:module';
import { buildSourceCatalog, readSourceFile, readCaptureSource, sha256 } from './source-catalog.mjs';
import { BACKGROUNDS, DEFAULT_BRAND, validateRecipe, resolveCapture } from './composition-recipe.mjs';
import { createScene, renderPhone, renderShadow, SCENE_PRESETS } from '../../scripts/lib/phone-frame.mjs';

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

/** Render approved source bytes in memory into the composition SVG, which is the
 * only artwork this module produces: every PNG anywhere is `rasterize` applied to
 * this string, so an export cannot drift from the artwork a preview showed.
 * Throws on invalid, missing or non-opted-in outdated captures. No filesystem
 * writes. Optional recipe.draft=true permits outdated/unverified sources with a
 * visible label.
 *
 * A publishable render carries the brand lockup and nothing else: capture
 * provenance belongs in the returned metadata, not burned into an image people
 * see. Only a draft keeps a visible label, because that is what makes it
 * unpublishable. */
export async function renderComposition(input, { repoRoot, catalog } = {}) {
  const recipe = validateRecipe(input);
  if (!repoRoot) throw new Error('repoRoot is required.');
  // A caller that already read the catalog passes it, so a render describes the
  // same sources the caller showed. Every capture is re-hashed below either way.
  catalog ??= await buildSourceCatalog(repoRoot);
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
  const scene = createScene(sources.map((source, i) => ({ key: source.id, width: source.width, height: source.height, frameId: recipe.phones[i].frameId })), { preset: recipe.preset, poses, shadow: recipe.shadow });
  if (poses) {
    // Keep the authored camera when shrinking/moving a phone, rather than fitting
    // away the edit. Expand only as necessary to keep the full chassis visible.
    const baseline = createScene(sources.map(source => ({ key: source.id, width: source.width, height: source.height })), { preset: recipe.preset, shadow: recipe.shadow });
    const x = Math.min(scene.x, baseline.x), y = Math.min(scene.y, baseline.y);
    scene.viewBox = `${x} ${y} ${Math.max(scene.x + scene.width, baseline.x + baseline.width) - x} ${Math.max(scene.y + scene.height, baseline.y + baseline.height) - y}`;
  }
  const { width, height } = recipe;
  const unit = Math.min(width, height);
  const margin = unit * 0.055;
  const ink = recipe.background === 'paper' ? '#171916' : '#f5f7f2';
  const draft = Boolean(recipe.draft);
  const brand = { ...DEFAULT_BRAND, ...(recipe.brand ?? {}) };
  const mark = brand.placement === 'none' ? undefined : await brandWatermark(catalog, repoRoot, sharp, brand, recipe.background, unit);
  // The watermark and any draft badge own a reserved band, so copy and phones
  // are laid out inside what is left rather than on top of the logo.
  const bandHeight = Math.max(mark?.inkHeight ?? 0, draft ? unit * 0.03 : 0);
  const band = bandHeight ? bandHeight + margin * 0.75 : 0;
  const atTop = mark ? brand.placement.startsWith('top') : false;
  const topBand = atTop ? band : 0;
  const disclosure = draft ? 'DRAFT - capture freshness not verified for publication' : 'App-source matched - native build freshness unverified';
  // disclosure describes the render; imageLabel is what the viewer actually sees,
  // and a publishable image shows none of it.
  const provenance = { version: 1, recipe, recipeSha256: sha256(JSON.stringify(recipe)), draft,
    disclosure, imageLabel: draft ? disclosure : null, brand, appSourceFingerprint: catalog.fingerprint,
    captures: sources.map((source, i) => ({ captureId: recipe.phones[i].captureId, canonicalId: source.id, source: source.source,
      sha256: source.sha256, freshness: source.freshness, evidenceClass: source.evidenceClass, captureEvidence: source.captureEvidence,
      functionalResult: source.functionalResult, publicationEligibility: source.publicationEligibility, publicationReview: source.publicationReview,
      frameId: recipe.phones[i].frameId ?? source.frameId, capturedAt: source.capturedAt, run: source.run, nativeBuild: source.nativeBuild })) };
  const outline = (value, font, size, x, y, opacity = 1) => {
    if ([...value].some(char => !/\s/.test(char) && !font.charToGlyphIndex(char))) throw new Error('Copy contains a glyph not supported by the bundled font.');
    const d = font.getPath(value, 0, 0, 1000, { kerning: true }).toPathData({ decimalPlaces: 3, flipY: false });
    if (/NaN|Infinity/.test(d)) throw new Error('Invalid text outline.');
    return `<path d="${d}" fill="${ink}"${opacity === 1 ? '' : ` fill-opacity="${opacity}"`} transform="translate(${x} ${y}) scale(${size / 1000})"/>`;
  };
  // Greedy wrapping leaves a lone short word on the last line - the orphan that
  // makes a headline read badly. Re-wrap at the narrowest measure that still
  // costs the same number of lines: the most even rag available for free.
  const lines = (value, font, size, maxWidth) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    const greedy = measure => {
      const result = [];
      let line = '';
      for (const word of words) {
        if (font.getAdvanceWidth(word, size) > measure) return undefined;
        const next = line ? `${line} ${word}` : word;
        if (font.getAdvanceWidth(next, size) > measure) { result.push(line); line = word; } else line = next;
      }
      if (line) result.push(line);
      return result;
    };
    const widest = greedy(maxWidth);
    if (!widest || widest.length < 2) return widest;
    let balanced = widest;
    for (let measure = maxWidth * 0.98; measure > maxWidth * 0.5; measure -= maxWidth * 0.02) {
      const candidate = greedy(measure);
      if (!candidate || candidate.length !== widest.length) break;
      balanced = candidate;
    }
    return balanced;
  };
  // Set as large as the measure allows, then step down only as far as the copy
  // needs: short copy fills its canvas instead of floating in it, and long copy
  // shrinks itself instead of making every image small.
  const fit = (value, font, maxSize, maxWidth, maxLines) => {
    for (let size = maxSize; size >= maxSize * 0.4; size *= 0.96) {
      const result = lines(value, font, size, maxWidth);
      if (result && result.length <= maxLines) return { lines: result, size };
    }
    throw new Error(lines(value, font, maxSize * 0.4, maxWidth)
      ? 'Copy does not fit. Shorten it or choose a wider canvas.'
      : 'A word is too wide. Shorten the copy or change the canvas.');
  };
  const titleLeading = 1.06, bodyLeading = 1.45;
  // Roughly sixty characters is a comfortable measure; a subtitle set to the
  // full width of a wide canvas runs to ninety and stops being readable.
  const readableWidth = (font, size) => (font.getAdvanceWidth('abcdefghijklmnopqrstuvwxyz ', size) * 60) / 27;
  const layoutCopy = (block, left, top, emit) => {
    let cursor = top + block.title.size * 0.8;
    for (const line of block.title.lines) {
      emit?.(outline(line, fonts.ExtraBold, block.title.size, left, cursor));
      cursor += block.title.size * titleLeading;
    }
    cursor -= block.title.size * (titleLeading - 0.8);
    for (const [index, line] of block.body.lines.entries()) {
      cursor += index ? block.body.size * bodyLeading : block.title.size * 0.3 + block.body.size * 0.8;
      emit?.(outline(line, fonts.Medium, block.body.size, left, cursor));
    }
    return cursor + (block.body.lines.length ? block.body.size : block.title.size) * 0.25;
  };
  const setCopy = (columnWidth, maxLines) => {
    const title = fit(recipe.headline, fonts.ExtraBold, Math.min(unit * 0.104, height * 0.17), columnWidth, maxLines);
    const size = Math.min(unit * 0.03, title.size * 0.36);
    const body = recipe.subtitle.trim()
      ? fit(recipe.subtitle, fonts.Medium, size, Math.min(columnWidth, readableWidth(fonts.Medium, size)), 4)
      : { lines: [], size };
    const block = { title, body };
    return { ...block, height: layoutCopy(block, 0, 0) };
  };
  // The caveat line sits quietly at the foot of the image, out of the sell but
  // still in the picture: a disclosure set at the size and weight of a benefit
  // competes with it, and the subtitle stops reading as a subtitle.
  const footSize = Math.min(unit * 0.022, 22);
  const footLines = recipe.footnote?.trim()
    ? lines(recipe.footnote, fonts.Medium, footSize, Math.min(width - 2 * margin, readableWidth(fonts.Medium, footSize))) ?? [recipe.footnote.trim()]
    : [];
  const footBlock = footLines.length ? footLines.length * footSize * 1.35 : 0;
  const foot = [];
  if (footBlock) {
    const top = height - margin - (atTop ? 0 : band) - footBlock;
    footLines.forEach((line, index) => foot.push(outline(line, fonts.Medium, footSize, margin, top + footSize * 0.8 + index * footSize * 1.35, 0.62)));
  }
  const footReserve = footBlock ? footBlock + margin * 0.5 : 0;
  const content = { x: margin, y: margin + topBand, width: width - 2 * margin,
    height: height - margin - (margin + topBand) - (atTop ? 0 : band) - footReserve };
  const gutter = margin * 0.85;
  // Two arrangements, measured rather than assumed: the copy above the stage or
  // beside it. Whichever renders the phones larger wins, so a tall subject never
  // sits in a wide empty band and a wide one never squeezes under a column of
  // copy. The canvas alone cannot decide that; the scene's aspect is half the answer.
  const candidates = [];
  for (const beside of [false, true]) {
    const columnWidth = beside ? content.width * 0.42 : content.width;
    let block;
    try { block = setCopy(columnWidth, beside ? 5 : 3); } catch (error) { if (!candidates.length && beside) throw error; continue; }
    const stage = beside
      ? { x: content.x + columnWidth + gutter, y: content.y, width: content.width - columnWidth - gutter, height: content.height }
      : { x: content.x, y: content.y + block.height + gutter, width: content.width, height: content.height - block.height - gutter };
    if (stage.width < unit * 0.12 || stage.height < unit * 0.12) continue;
    const scale = Math.min(stage.width / scene.width, stage.height / scene.height);
    candidates.push({ beside, block, stage, area: scene.width * scene.height * scale * scale });
  }
  if (!candidates.length) throw new Error('Copy leaves too little room for phones. Shorten it.');
  const chosen = candidates.reduce((best, item) => (item.area > best.area ? item : best));
  // Beside, the copy column is centred against the stage; above, it starts at
  // the top of the content area and the stage takes everything left.
  const copy = [];
  layoutCopy(chosen.block, content.x, chosen.beside ? content.y + (content.height - chosen.block.height) / 2 : content.y, path => copy.push(path));
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
    const size = Math.min(width * 0.0145, 16, room / fonts.Medium.getAdvanceWidth(disclosure, 1));
    const badgeWidth = fonts.Medium.getAdvanceWidth(disclosure, size);
    const badgeX = mark && side === 'left' ? width - margin - badgeWidth : margin;
    badge = outline(disclosure, fonts.Medium, size, badgeX, bandY + bandHeight * 0.75);
  }
  const box = chosen.stage;
  // Every shadow is painted before every phone: they all lie on one plane
  // behind the devices, so a shadow can never fall across a chassis in front.
  const shadowSvg = scene.ground ? scene.phones.map(phone => renderShadow(phone, { id: `phone-${phone.index}`, plane: scene.ground })).join('') : '';
  const phoneSvg = scene.phones.map(phone => renderPhone(phone, { id: `phone-${phone.index}`, href: embedded[phone.index], alt: sources[phone.index].title })).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${escape(recipe.title)}</title><metadata>${escape(JSON.stringify(provenance))}</metadata><rect width="${width}" height="${height}" fill="${BACKGROUNDS[recipe.background]}"/>${copy.join('')}${foot.join('')}<svg x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" viewBox="${scene.viewBox}" preserveAspectRatio="xMidYMid meet">${shadowSvg}${phoneSvg}</svg>${logo}${badge}</svg>`;
  return { svg, provenance };
}

/** Rasterize a composition SVG. Exports go through here rather than through a
 * second drawing path, so the PNG is always the SVG a preview already showed. */
export async function rasterize(svg) {
  const { sharp } = await renderingRuntime();
  const png = await sharp(Buffer.from(svg), { limitInputPixels: 5_000_000 }).timeout({ seconds: 30 }).png().toBuffer();
  if (png.length > 24 * 1024 * 1024) throw new Error('Rendered image exceeds byte limit.');
  return png;
}
