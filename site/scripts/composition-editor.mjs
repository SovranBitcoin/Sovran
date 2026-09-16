import { element, fetchSources } from './catalog-browser.mjs';
import { BRAND_LOCKUPS, BRAND_PLACEMENTS, DEFAULT_BRAND, POSE_LIMITS, validateRecipe, recipeHash, recipeFromHash, resolveCapture } from './composition-recipe.mjs';

export function mountCompositionEditor() {
  const get = id => document.getElementById(id);
  const status = get('social-status'), renderStatus = get('render-status');
  const gallery = get('concept-gallery'), form = get('composition-form');
  const download = get('download-composition'), preview = get('composition-preview');
  let catalog, recipe, revision = 0, renderBusy = false, galleryBusy = false, editorWaiting = false;
  let outputUrl;
  const thumbnailUrls = new Set();
  let cards = [], observer;
  const presetNames = ['single-tilt', 'duo-mirror', 'triple-fan', 'quartet-grid'];
  const placementLabels = { none: 'No watermark', 'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right',
    'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right' };
  const lockupLabels = { wordmark: 'Logo and name', symbol: 'Symbol only' };
  const formats = ['square', 'portrait', 'story', 'landscape'];
  function setOptions(select, entries, selected) {
    select.replaceChildren(...entries.map(([value, label]) => {
      const option = element('option', label); option.value = value; return option;
    }));
    select.value = selected;
  }
  function invalidate() {
    revision++;
    download.hidden = true; download.removeAttribute('href');
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = undefined;
    preview.replaceChildren(element('p', 'Recipe changed. Render to see the final image.'));
    get('composition-provenance').textContent = 'No render for this recipe.';
  }
  function persist() {
    try {
      validateRecipe(recipe);
      history.replaceState(null, '', `${location.pathname}${location.search}${recipeHash(recipe)}`);
      renderStatus.textContent = 'Ready to render. Changes are stored in the URL.';
    } catch (error) { renderStatus.textContent = error.message; }
  }
  const edited = () => { invalidate(); persist(); };
  function phoneControls() {
    get('phone-controls').replaceChildren(...recipe.phones.map((phone, index) => {
      const fieldset = element('fieldset', undefined, 'phone-control');
      fieldset.append(element('legend', `Phone ${index + 1}`));
      const row = element('div', undefined, 'editor-row');
      const platformLabel = element('label', 'Platform');
      const platform = element('select');
      setOptions(platform, [['ios', 'iOS'], ['android', 'Android']], phone.captureId.split('/')[0]);
      platformLabel.append(platform);
      const captureLabel = element('label', 'Screenshot');
      const capture = element('select');
      const updateCaptures = () => {
        const entries = catalog.captures.filter(item => item.platform === platform.value);
        const selected = resolveCapture(catalog, phone.captureId);
        setOptions(capture, entries.map(item => [item.id, `${item.page} / ${item.stateId ?? 'default'} / ${item.freshness}${item.available ? ` / ${item.evidenceClass}` : ` / ${item.attemptStatus}`}`]), selected?.id ?? phone.captureId);
        for (const option of capture.options) {
          const source = resolveCapture(catalog, option.value);
          option.disabled = !source?.available;
        }
        if (!selected) {
          const option = element('option', `${phone.captureId} / not registered`); option.value = phone.captureId; capture.append(option); capture.value = phone.captureId;
        }
      };
      updateCaptures(); captureLabel.append(capture); row.append(platformLabel, captureLabel); fieldset.append(row);
      const frameLabel = element('label', 'Frame (native ratio retained)');
      const frame = element('select');
      const updateFrames = () => setOptions(frame, [['', 'Automatic native profile'], ...catalog.frames[platform.value].map(id => [id, id])], phone.frameId ?? '');
      updateFrames(); frameLabel.append(frame); fieldset.append(frameLabel);
      platform.addEventListener('change', () => {
        // Keep the same page when that platform actually has it; otherwise move
        // to a capture that exists, rather than selecting a withheld image.
        const wanted = `${platform.value}/${phone.captureId.split('/')[1]}`;
        const available = catalog.captures.filter(item => item.platform === platform.value && item.available);
        phone.captureId = available.some(item => item.id === wanted || item.aliases?.includes(wanted))
          ? wanted : (available[0]?.id ?? wanted);
        delete phone.frameId; updateCaptures(); updateFrames(); edited();
      });
      capture.addEventListener('change', () => { phone.captureId = capture.value; delete phone.frameId; updateFrames(); edited(); });
      frame.addEventListener('change', () => { if (frame.value) phone.frameId = frame.value; else delete phone.frameId; edited(); });
      const details = element('details'); details.append(element('summary', 'Pose, scale and order (auto-fit)'));
      const poseGrid = element('div', undefined, 'pose-grid');
      for (const [key, [min, max]] of Object.entries(POSE_LIMITS)) {
        const label = element('label', ({ rotateX: 'Pitch', rotateY: 'Yaw', rotateZ: 'Roll', x: 'Horizontal', y: 'Vertical', z: 'Depth', scale: 'Scale' })[key]);
        const input = element('input'); input.type = 'number'; input.min = min; input.max = max; input.step = key === 'scale' ? 0.05 : 1;
        input.value = phone.pose?.[key] ?? catalog.presets[recipe.preset].poses[index][key] ?? (key === 'scale' ? 1 : 0);
        input.addEventListener('input', () => { phone.pose ??= {}; phone.pose[key] = input.valueAsNumber; edited(); });
        label.append(input); poseGrid.append(label);
      }
      details.append(poseGrid);
      const actions = element('div', undefined, 'source-actions');
      for (const [label, offset] of [['Move earlier', -1], ['Move later', 1]]) {
        const button = element('button', label); button.type = 'button'; button.disabled = index + offset < 0 || index + offset >= recipe.phones.length;
        button.addEventListener('click', () => { const target = index + offset; [recipe.phones[index], recipe.phones[target]] = [recipe.phones[target], recipe.phones[index]]; edited(); phoneControls(); });
        actions.append(button);
      }
      const reset = element('button', 'Reset pose'); reset.type = 'button'; reset.addEventListener('click', () => { delete phone.pose; edited(); phoneControls(); }); actions.append(reset);
      details.append(actions); fieldset.append(details); return fieldset;
    }));
  }
  function brandControls() {
    const brand = { ...DEFAULT_BRAND, ...(recipe.brand ?? {}) };
    setOptions(get('brand-placement'), BRAND_PLACEMENTS.map(value => [value, placementLabels[value]]), brand.placement);
    setOptions(get('brand-lockup'), BRAND_LOCKUPS.map(value => [value, lockupLabels[value]]), brand.lockup);
    get('brand-scale').value = brand.scale;
    get('brand-scale').disabled = get('brand-lockup').disabled = brand.placement === 'none';
  }
  function selectRecipe(value, scroll = true) {
    recipe = validateRecipe(value); invalidate();
    for (const [id, key] of [['recipe-title', 'title'], ['headline', 'headline'], ['subtitle', 'subtitle'], ['background', 'background'], ['canvas-width', 'width'], ['canvas-height', 'height']]) get(id).value = recipe[key];
    get('recipe-draft').checked = Boolean(recipe.draft);
    brandControls();
    get('preset').value = recipe.preset;
    get('canvas').value = formats.find(format => catalog.formats[format].width === recipe.width && catalog.formats[format].height === recipe.height) ?? 'custom';
    phoneControls(); persist(); get('social-editor').open = true;
    if (scroll) get('social-editor').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  async function render(value) {
    const response = await fetch('/__artwork/render', { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validateRecipe(value)) });
    if (response.status === 429) throw new Error('Another render is running. Try again shortly.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Render failed.');
    const bytes = Uint8Array.from(atob(result.png), char => char.charCodeAt(0));
    return { url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), provenance: result.provenance };
  }
  function queueThumbnails() {
    if (galleryBusy || renderBusy || editorWaiting) return;
    const card = cards.find(card => card.visible && !card.started && !card.element.hidden && card.eligible);
    if (!card) return;
    card.started = true; galleryBusy = true;
    card.note.textContent = 'Rendering preview...';
    render(card.recipe).then(result => {
      if (!cards.includes(card)) { URL.revokeObjectURL(result.url); return; }
      thumbnailUrls.add(result.url);
      card.url = result.url;
      if (thumbnailUrls.size > 24) {
        const old = cards.find(item => item.url && !item.visible);
        if (old) {
          URL.revokeObjectURL(old.url); thumbnailUrls.delete(old.url); old.url = undefined; old.started = false;
          old.preview.replaceChildren(element('p', 'Preview renders when visible'));
        }
      }
      const image = element('img'); image.src = result.url; image.alt = card.recipe.title; image.loading = 'lazy';
      image.width = card.recipe.width; image.height = card.recipe.height;
      card.preview.replaceChildren(image); card.note.textContent = result.provenance.disclosure;
    }).catch(error => { card.note.textContent = error.message; }).finally(() => { galleryBusy = false; queueThumbnails(); });
  }
  function filterGallery() {
    let visible = 0;
    for (const card of cards) {
      const show = card.recipe.title.toLowerCase().includes(get('concept-search').value.toLowerCase()) &&
        (!get('concept-count').value || card.recipe.phones.length === Number(get('concept-count').value)) &&
        (!get('concept-ratio').value || card.format === get('concept-ratio').value);
      card.element.hidden = !show; if (show) visible++;
    }
    status.textContent = `${visible} templates. Sources: ${catalog.captures.filter(capture => capture.available).length} retained, ${catalog.captures.filter(capture => capture.available && capture.freshness !== 'current').length} not current. ${catalog.diagnostics.join(' ')}`;
    queueThumbnails();
  }
  function galleryCards() {
    observer?.disconnect(); cards = [];
    for (const url of thumbnailUrls) URL.revokeObjectURL(url); thumbnailUrls.clear();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const card = cards.find(card => card.element === entry.target); if (card) card.visible = entry.isIntersecting; }
      queueThumbnails();
    }, { rootMargin: '100px' });
    for (const concept of catalog.concepts) for (let count = 1; count <= concept.captureIds.length; count++) for (const format of formats) {
      const value = { version: 1, id: `${concept.id}-${count}-${format}`, title: `${concept.title} / ${count} ${count === 1 ? 'phone' : 'phones'} / ${format}`,
        headline: concept.headline, subtitle: concept.subtitle, background: 'charcoal', ...catalog.formats[format], preset: presetNames[count - 1],
        phones: concept.captureIds.slice(0, count).map(captureId => ({ captureId })), ...(get('gallery-draft').checked ? { draft: true } : {}) };
      const sources = value.phones.map(phone => resolveCapture(catalog, phone.captureId));
      const available = sources.every(source => source?.available);
      const eligible = available && (value.draft || sources.every(source => source.freshness === 'current'));
      const article = element('article', undefined, 'concept-card');
      const image = element('div', undefined, 'concept-preview');
      image.append(element('p', !available ? 'Capture requested' : eligible ? 'Preview renders when visible' : 'Draft previews are off'));
      const note = element('p', !available ? 'One or more registered sources are missing.' : eligible ? 'Waiting for preview.' : 'Enable draft previews above to inspect outdated sources.', 'gallery-meta');
      const button = element('button', 'Edit composition'); button.type = 'button';
      button.addEventListener('click', () => selectRecipe(value));
      article.append(image, element('h3', value.title), element('p', value.phones.map(phone => phone.captureId).join(' + '), 'gallery-meta'), note, button);
      cards.push({ element: article, preview: image, note, recipe: value, format, eligible, started: false, visible: false });
    }
    gallery.replaceChildren(...cards.map(card => card.element));
    for (const card of cards) observer.observe(card.element);
    filterGallery();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!recipe || renderBusy) return;
    editorWaiting = true;
    renderStatus.textContent = galleryBusy ? 'Finishing the visible template, then rendering your composition...' : 'Rendering final image...';
    // One shared local render slot; editor work takes priority over lazy thumbnails.
    while (galleryBusy) await new Promise(resolve => setTimeout(resolve, 100));
    editorWaiting = false; renderBusy = true; get('render-composition').disabled = true;
    const current = revision;
    try {
      const result = await render(recipe);
      if (current !== revision) { URL.revokeObjectURL(result.url); return; }
      if (outputUrl) URL.revokeObjectURL(outputUrl); outputUrl = result.url;
      const image = element('img'); image.src = outputUrl; image.alt = recipe.title; image.width = recipe.width; image.height = recipe.height;
      preview.replaceChildren(image);
      download.href = outputUrl; download.download = `${result.provenance.draft ? 'draft' : 'source-matched-native-unverified'}-${recipe.id}.png`;
      download.textContent = `Download PNG (${result.provenance.draft ? 'draft' : 'native freshness unverified'})`; download.hidden = false;
      renderStatus.textContent = `${recipe.width} x ${recipe.height}. ${result.provenance.disclosure}. Preview and download use identical bytes.`;
      get('composition-provenance').textContent = JSON.stringify(result.provenance, null, 2);
    } catch (error) { if (current === revision) renderStatus.textContent = error.message; }
    finally { renderBusy = false; get('render-composition').disabled = false; queueThumbnails(); }
  });
  for (const [id, key] of [['recipe-title', 'title'], ['headline', 'headline'], ['subtitle', 'subtitle'], ['background', 'background'], ['canvas-width', 'width'], ['canvas-height', 'height']])
    get(id).addEventListener('input', () => { if (!recipe) return; recipe[key] = ['width', 'height'].includes(key) ? get(id).valueAsNumber : get(id).value; if (['width', 'height'].includes(key)) get('canvas').value = 'custom'; edited(); });
  get('recipe-draft').addEventListener('change', () => { if (recipe) { recipe.draft = get('recipe-draft').checked; edited(); } });
  for (const [id, key] of [['brand-placement', 'placement'], ['brand-lockup', 'lockup'], ['brand-scale', 'scale']])
    get(id).addEventListener('change', () => {
      if (!recipe) return;
      const value = key === 'scale' ? get(id).valueAsNumber : get(id).value;
      recipe.brand = { ...DEFAULT_BRAND, ...recipe.brand, [key]: value };
      brandControls(); edited();
    });
  get('canvas').addEventListener('change', () => { if (recipe && catalog.formats[get('canvas').value]) selectRecipe({ ...recipe, ...catalog.formats[get('canvas').value] }, false); });
  get('preset').addEventListener('change', () => {
    if (!recipe) return;
    const count = catalog.presets[get('preset').value].poses.length;
    const phones = recipe.phones.map(({ captureId, frameId }) => ({ captureId, ...(frameId ? { frameId } : {}) })).slice(0, count);
    const candidates = catalog.concepts.find(concept => concept.captureIds.includes(phones[0].captureId))?.captureIds ?? [];
    for (const captureId of candidates) if (phones.length < count && !phones.some(phone => phone.captureId === captureId)) phones.push({ captureId });
    if (phones.length !== count) { get('preset').value = recipe.preset; renderStatus.textContent = 'This concept has too few related captures. Choose a larger template from the gallery.'; return; }
    selectRecipe({ ...recipe, preset: get('preset').value, phones }, false);
  });
  get('export-recipe').addEventListener('click', () => {
    try {
      const value = validateRecipe(recipe), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = element('a'); anchor.href = url; anchor.download = `${value.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { renderStatus.textContent = error.message; }
  });
  get('import-recipe').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { if (file.size > 16384) throw new Error('Recipe exceeds 16 KiB.'); selectRecipe(JSON.parse(await file.text()), false); }
    catch (error) { renderStatus.textContent = `Import rejected: ${error.message}`; }
    event.target.value = '';
  });
  for (const id of ['concept-search', 'concept-count', 'concept-ratio']) get(id).addEventListener('input', () => { if (catalog) filterGallery(); });
  get('gallery-draft').addEventListener('change', () => { if (catalog) galleryCards(); });
  window.addEventListener('hashchange', () => { if (catalog && location.hash) { try { selectRecipe(recipeFromHash(location.hash), false); } catch (error) { renderStatus.textContent = error.message; } } });
  window.addEventListener('pagehide', () => { if (outputUrl) URL.revokeObjectURL(outputUrl); for (const url of thumbnailUrls) URL.revokeObjectURL(url); observer?.disconnect(); });
  fetchSources().then(value => {
    catalog = value;
    setOptions(get('preset'), Object.entries(catalog.presets).map(([id, preset]) => [id, preset.name]), 'single-tilt');
    setOptions(get('canvas'), [...formats.map(format => [format, `${format} / ${catalog.formats[format].width} x ${catalog.formats[format].height}`]), ['custom', 'Custom dimensions']], 'square');
    galleryCards();
    if (location.hash) {
      try { selectRecipe(recipeFromHash(location.hash), false); } catch (error) { renderStatus.textContent = `URL recipe rejected: ${error.message}`; }
    } else if (cards[0]) { selectRecipe(cards[0].recipe, false); get('social-editor').open = false; }
  }).catch(error => { status.textContent = error.message; });
}
