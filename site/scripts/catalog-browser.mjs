/** The one reviewed body per platform; anything else is labelled off-profile. */
const LIBRARY_FRAME = { ios: 'iphone-17-pro-max', android: 'android-emulator' };

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export async function fetchSources() {
  const response = await fetch('/__artwork/sources', { credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Local sources unavailable. Use the site dev server, then refresh.');
  const catalog = await response.json();
  if (catalog.version !== 1 || !Array.isArray(catalog.captures) || !Array.isArray(catalog.logos)) throw new Error('Unrecognized source catalog. Restart the site dev server.');
  return catalog;
}
function imageUrl(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid asset hash.');
  return `/__artwork/image/${hash}`;
}
function preview(source, alt) {
  const link = element('a', undefined, 'source-preview');
  link.href = imageUrl(source.sha256); link.target = '_blank'; link.rel = 'noopener';
  link.setAttribute('aria-label', `Open original: ${alt}`);
  const image = element('img');
  image.alt = alt; image.loading = 'lazy'; image.decoding = 'async';
  if (source.width) { image.width = source.width; image.height = source.height; }
  image.src = link.href;
  image.addEventListener('error', () => link.replaceChildren(element('p', 'Image unavailable. Refresh sources.')), { once: true });
  link.append(image); return link;
}
function download(source, label, name) {
  const link = element('a', label, 'dev-action');
  link.href = imageUrl(source.sha256); link.download = name; return link;
}
export function mountScreenshots() {
  const grid = document.querySelector('#capture-groups');
  const status = document.querySelector('#catalog-status');
  const search = document.querySelector('#capture-search');
  const filter = document.querySelector('#capture-status');
  const attempt = document.querySelector('#capture-attempt');
  const drafts = document.querySelector('#capture-drafts');
  const refresh = document.querySelector('#catalog-refresh');
  let catalog;
  const render = () => {
    const groups = new Map();
    for (const capture of catalog.captures) {
      const key = `${capture.page}\0${capture.stateId ?? capture.id.split('/')[1]}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(capture);
    }
    const sections = [];
    for (const captures of groups.values()) {
      if (!captures.some(capture => (!filter.value || capture.freshness === filter.value) && (!attempt.value || capture.attemptStatus === attempt.value) && JSON.stringify(capture).toLowerCase().includes(search.value.toLowerCase()))) continue;
      const section = element('section', undefined, 'capture-group');
      section.append(element('h2', `${captures[0].page} / ${captures[0].stateId ?? 'default'}`), element('p', captures[0].state, 'gallery-meta'));
      const pair = element('div', undefined, 'capture-pair');
      for (const platform of ['ios', 'android']) {
        const capture = captures.find(item => item.platform === platform);
        const article = element('article', undefined, 'capture-source');
        article.append(element('h3', platform === 'ios' ? 'iOS' : 'Android'));
        if (!capture) { article.append(element('p', 'notattempted')); pair.append(article); continue; }
        article.id = capture.id;
        const statusLine = element('div', undefined, 'capture-status-line');
        statusLine.append(element('p', `Image: ${capture.available ? capture.freshness : 'no usable image'}`, capture.freshness === 'current' ? 'gallery-meta' : 'gallery-warning'));
        statusLine.append(element('p', `Capture attempt: ${capture.attemptStatus}`, capture.attemptStatus === 'blocked' || capture.attemptStatus === 'failed' ? 'gallery-warning' : 'gallery-meta'));
        // Device is inline, not buried in the evidence panel: one off-profile
        // capture in a grid of phones is the thing you need to spot at a glance.
        if (capture.width) {
          const offProfile = capture.frameId !== LIBRARY_FRAME[capture.platform];
          statusLine.append(element('p', `Device: ${capture.frameId ?? 'unknown'} · ${capture.width}x${capture.height}${offProfile ? ' (off library-v1)' : ''}`, offProfile ? 'gallery-warning' : 'gallery-meta'));
        }
        article.append(statusLine);
        const canPreview = capture.available && (capture.freshness === 'current' || drafts.checked);
        if (canPreview) {
          article.append(preview(capture, `${capture.title} (${capture.freshness})`));
          article.append(download(capture, `Download original PNG (${capture.freshness})`, `${capture.freshness === 'current' ? 'source-matched-native-unverified' : `draft-${capture.freshness}`}-${capture.id.replace('/', '-')}.png`));
        } else {
          article.append(element('div', capture.available ? 'Draft preview is off. Enable it above to inspect these older or unverified pixels.' : capture.blocker || capture.reason || capture.attemptReason || (capture.attemptStatus === 'failed' ? 'Latest capture attempt failed. See capture evidence.' : 'No retained capture yet.'), 'source-empty'));
          article.append(element('span', 'No original download available', 'gallery-meta'));
        }
        article.append(element('code', capture.id));
        const evidence = element('details'); evidence.append(element('summary', 'Capture evidence'));
        const claims = element('p', `${capture.available ? capture.evidenceClass : 'No image evidence'} / functional result: ${capture.functionalResult}. Publication: ${capture.publicationEligibility}; review: ${capture.publicationReview}.`, 'gallery-meta');
        const attempts = element('div', undefined, 'capture-attempt-evidence');
        if (capture.blocker) attempts.append(element('p', `Blocker: ${capture.blocker}`, 'gallery-warning'));
        if (capture.attemptReason) attempts.append(element('p', `Attempt reason: ${capture.attemptReason}`));
        if (capture.latestAttempt) attempts.append(element('p', `Latest attempt: ${JSON.stringify(capture.latestAttempt)}`));
        if (capture.plan) attempts.append(element('p', `Plan: ${capture.plan.source} / ${capture.plan.scenario ?? 'no approved scenario'} / ${capture.plan.stepId ?? 'no capture step'}`));
        article.append(claims, attempts);
        evidence.append(element('p', capture.context.purpose ?? 'No reviewed purpose metadata yet.'));
        if (capture.width) evidence.append(element('p', `${capture.width} x ${capture.height} original pixels`));
        evidence.append(element('pre', JSON.stringify({ source: capture.source, aliases: capture.aliases, capturedAt: capture.capturedAt, run: capture.run, sha256: capture.sha256, nativeBuild: capture.nativeBuild, appSource: capture.appSource, captureProfile: capture.captureProfile, captureEvidence: capture.captureEvidence, plan: capture.plan, latestAttempt: capture.latestAttempt }, null, 2)));
        article.append(evidence); pair.append(article);
      }
      section.append(pair); sections.push(section);
    }
    grid.replaceChildren(...sections);
    const devices = ['ios', 'android'].map(platform => {
      const ids = [...new Set(catalog.captures.filter(capture => capture.platform === platform && capture.available && capture.frameId).map(capture => capture.frameId))];
      return ids.length ? `${platform}: ${ids.join(', ')}` : `${platform}: no retained captures`;
    }).join('; ');
    status.textContent = `${sections.length} page/state pairs shown. ${catalog.coverage.baselineSlots} / ${catalog.coverage.baselineDenominator} canonical baseline slots catalogued. ${catalog.captures.filter(capture => capture.available).length} retained captures. Devices — ${devices}. Inventory: ${catalog.coverage.inventorySource}.${catalog.diagnostics.length ? ` ${catalog.diagnostics.join(' ')}` : ''}`;
  };
  async function load() {
    refresh.disabled = true;
    try { catalog = await fetchSources(); render(); }
    catch (error) { grid.replaceChildren(); status.textContent = error.message; }
    finally { refresh.disabled = false; }
  }
  document.querySelector('form').addEventListener('submit', event => event.preventDefault());
  for (const control of [search, filter, attempt, drafts]) control.addEventListener('input', () => { if (catalog) render(); });
  refresh.addEventListener('click', load); load();
}

export function mountLogos() {
  const grid = document.querySelector('#logo-groups');
  const status = document.querySelector('#catalog-status');
  const refresh = document.querySelector('#catalog-refresh');
  async function load() {
    refresh.disabled = true;
    try {
      const catalog = await fetchSources();
      const layouts = [...new Set(catalog.logos.map(logo => logo.layout))];
      grid.replaceChildren(...layouts.map(layout => {
        const section = element('section'); section.append(element('h2', layout));
        const variants = element('div', undefined, 'logo-grid');
        for (const logo of catalog.logos.filter(item => item.layout === layout)) {
          const article = element('article', undefined, 'logo-variant');
          article.append(element('h3', logo.theme));
          const outputs = [...logo.outputs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
          const source = outputs.find(output => output.format === 'svg') ?? outputs.at(-1);
          if (!source) { article.append(element('p', 'Missing brand outputs. Run the brand generator.')); variants.append(article); continue; }
          article.append(preview(source, `${layout}, ${logo.theme}`));
          const label = element('label', 'PNG size');
          const select = element('select'); select.setAttribute('aria-label', `${layout} ${logo.theme} PNG size`);
          const pngs = outputs.filter(output => output.format === 'png');
          for (const png of pngs) { const option = element('option', `${png.width} x ${png.height}`); option.value = png.sha256; select.append(option); }
          select.value = (pngs.find(png => png.width === 512) ?? pngs.at(-1))?.sha256 ?? '';
          label.append(select); article.append(label);
          const actions = element('div', undefined, 'source-actions');
          const evidence = element('p', source.freshness === 'current-render' ? 'Source and output hashes matched' : source.freshness === 'source-matched-output-unverified' ? 'Source hashes matched; SVG output hash not recorded in manifest.' : 'Stale render: regenerate before publication', source.freshness === 'stale-render' ? 'gallery-warning' : 'gallery-meta');
          article.append(evidence);
          if (source.format === 'svg') actions.append(download(source, `SVG (${source.freshness})`, `${source.freshness}-${layout}-${logo.theme}.svg`));
          const update = () => {
            actions.querySelector('[data-png]')?.remove();
            const png = pngs.find(png => png.sha256 === select.value);
            if (png) { const link = download(png, `PNG (${png.freshness})`, `${png.freshness}-${layout}-${logo.theme}-${png.width}x${png.height}.png`); link.dataset.png = ''; actions.append(link); }
          };
          select.addEventListener('change', update); update(); article.append(actions); variants.append(article);
        }
        section.append(variants); return section;
      }));
      status.textContent = `${catalog.logos.length} colorways in ${layouts.length} layouts. ${catalog.diagnostics.join(' ')}`;
    } catch (error) { grid.replaceChildren(); status.textContent = error.message; }
    finally { refresh.disabled = false; }
  }
  refresh.addEventListener('click', load); load();
}
