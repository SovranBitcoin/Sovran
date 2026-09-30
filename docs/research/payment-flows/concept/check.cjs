// Headless check: node check.cjs (run from sovran-app root; uses its jsdom).
// Clicks every paste, tap payload, person, receive mode and token example in
// each scenario, fails on script errors and on copy over the 150-char budget.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'dist/send-receive-forms.html'), 'utf8');
const problems = [];
for (const [air, down] of [[false, ''], [true, ''], [false, 'sovran'], [false, 'minibits'], [false, 'third']]) {
  const d = new JSDOM(html, { runScripts: 'dangerously' });
  const w = d.window, doc = w.document, q = (s) => doc.querySelector(s);
  w.addEventListener('error', (e) => problems.push(`script error: ${e.message}`));
  const set = (id, v) => { const e = doc.getElementById(id); e.checked = v; e.dispatchEvent(new w.Event('change')); };
  set('airplane', air); { const e = doc.getElementById('mintdown'); e.value = down; e.dispatchEvent(new w.Event('change')); }
  const budget = (where) => doc.querySelectorAll('.cdesc,.hint,.why,.verdict,.trace li').forEach((e) => {
    const t = e.textContent.replace(/\s+/g, ' ').trim(); if (t.length > 150) problems.push(`${where}: ${t.length} chars: ${t.slice(0, 80)}`);
  });
  const who = () => q('#send-steps [data-go="0"]')?.click();
  // Finish any receive receipt, then start over (a receipt in progress has no reset until it settles).
  const freshRecv = () => { for (let n = 0; n < 8 && q('#recv-steps [data-tlnext]'); n++) q('#recv-steps [data-tlnext]').click(); q('#recv-steps [data-reset]')?.click(); q('#recv-steps [data-go="0"]')?.click(); };
  // Lock on a mint without NUT-11 asks for one that can; picking it keeps the lock.
  { who(); q('[data-dd]').click(); q('[data-person="bob"]').click(); q('#send-steps [data-mintmenu]')?.click(); q('#send-steps [data-mintsel="third"]')?.click(); q('#send-steps [data-next]')?.click();
    const h = doc.getElementById('s-how-ecash'); if (h) { h.checked = true; h.dispatchEvent(new w.Event('change', { bubbles: true })); }
    const lk = doc.getElementById('s-lockon'); if (lk) { lk.checked = true; lk.dispatchEvent(new w.Event('change', { bubbles: true })); budget('lock needs a p2pk mint');
      // Another mint can lock, so the picker opens at once: no Change mint tap.
      const chg = q('#send-steps .dd-list'); if (!down && !air && !chg) problems.push('lock did not open the mint picker directly');
      if (chg && q('#send-steps .dd-opt[data-mintsel="third"]:not([disabled])')) problems.push('mint without NUT-11 not disabled');
      const pick = q('#send-steps .dd-opt[data-mintsel]:not([disabled]):not([data-mintsel=""])'); pick?.click(); if (chg && pick && !q('#send-steps .lockseg')) problems.push('lock lost after changing mint'); }
    q('#send-steps [data-mintmenu]')?.click(); q('#send-steps [data-mintsel=""]')?.click(); }
  // Each mint as primary: every contact and paste still renders within budget.
  for (const prim of ['third', 'minibits', 'sovran']) {
    q(`[data-primary="${prim}"]`).click(); if (!q(`[data-primary="${prim}"][aria-pressed="true"]`)) problems.push(`primary ${prim} not set`);
    for (const p of ['alice', 'bob', 'carol', 'dave']) { who(); q('[data-dd]').click(); q(`[data-person="${p}"]`).click(); budget(`primary ${prim} ${p}`); }
  }
  // Every person: open the mint control, send, and check the receipt renders within budget.
  for (const p of ['alice', 'bob', 'carol', 'dave']) {
    who(); q('[data-dd]').click(); q(`[data-person="${p}"]`).click(); budget(`person ${p}`);
    q('#send-steps [data-mintmenu]')?.click(); budget(`mint menu ${p}`); q('#send-steps [data-mintmenu]')?.click();
    // Lock: switch on, try every take-back period, leave it on the last.
    const lk = doc.getElementById('s-lockon'); if (lk) { lk.checked = true; lk.dispatchEvent(new w.Event('change', { bubbles: true })); for (const v of [1, 2, 3, 4, 5]) { q(`#send-steps [data-lock="${v}"]`)?.click(); budget(`lock ${p} ${v}`); } }
    const cta = q('#send-steps .step.active .cta:not([disabled])'); if (cta) { cta.click(); budget(`receipt ${p}`);
      // Walk the timeline to the end, then replay and fail the first step.
      for (let k = 0; k < 8 && q('[data-tlnext]'); k++) { q('[data-tlnext]').click(); budget(`timeline ${p} ${k}`); }
      q('[data-tlreset]')?.click(); q('[data-tlfail]')?.click(); budget(`timeline fail ${p}`); if (!q('.receipt') && !q('.done-msg')) problems.push(`no receipt for ${p}`); q('[data-reset]')?.click(); }
  }
  who(); q('#send-steps [data-entry="paste"]').click();
  for (const v of [...doc.querySelectorAll('[data-paste]')].map((x) => x.dataset.paste)) {
    who(); if (!q('[data-entry="paste"][aria-pressed="true"]')) q('[data-entry="paste"]').click();
    [...doc.querySelectorAll('[data-paste]')].find((x) => x.dataset.paste === v).click(); budget(`paste ${v}`);
  }
  who(); q('#send-steps [data-entry="tap"]').click();
  for (const k of [...doc.querySelectorAll('[data-payload]')].map((x) => x.dataset.payload)) { q('[data-pdd]').click(); q(`[data-payload="${k}"]`)?.click(); budget(`tap ${k}`); }
  // Scanner: every example routes somewhere (Send with it pasted, or Receive › Claim), within budget.
  q('#open-scan').click(); if (q('#sheet-scan').hidden) problems.push('scanner did not open');
  for (const src of ['camera', 'paste', 'photos']) {
    q('#open-scan').click(); q(`[data-src="${src}"]`).click();
    const items = [...doc.querySelectorAll('#scan-list [data-scan], #scan-list [data-scanfail]')].map((b) => [b.dataset.scan, b.dataset.scantoken, b.dataset.scanfail]);
    if (items.length < 8) problems.push(`scanner ${src}: only ${items.length} examples`);
    for (const [v, k, fail] of items) {
      q('#open-scan').click(); q(`[data-src="${src}"]`).click();
      const b = [...doc.querySelectorAll('#scan-list [data-scan], #scan-list [data-scanfail]')].find((x) => x.dataset.scan === v && x.dataset.scantoken === k && x.dataset.scanfail === fail); b.click();
      if (fail) { if (q('#sheet-scan').hidden || !q('#scan-msg').textContent) problems.push(`scan failure not explained: ${fail}`); q('#sheet-scan [data-close]').click(); }
      else if (!q('#sheet-scan').hidden) problems.push(`scan example not routed (${src}): ${v}`);
      budget(`scan ${src} ${v || fail}`);
      freshRecv();
    }
  }
  // Enter in the amount field presses the bottom button; it never jumps to a receipt behind the user's back.
  doc.getElementById('tab-send').click(); q('#send-steps [data-go="0"]')?.click(); q('[data-reset]')?.click();
  q('#send-steps [data-entry="token"]').click();
  { const i = q('#s-amount'); i.value = ''; i.dispatchEvent(new w.Event('input', { bubbles: true })); q('#s-amount').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); if (q('.receipt')) problems.push('Enter submitted with no amount'); }
  // Sheets open and close; every theme applies.
  q('#open-settings').click(); if (q('#sheet-settings').hidden) problems.push('settings sheet did not open'); q('#sheet-settings [data-close]').click();
  q('#open-research').click(); if (q('#sheet-research').hidden) problems.push('research sheet did not open'); if ((q('#failmap tbody')?.children.length || 0) < 20) problems.push('failure table missing'); budget('research'); q('#sheet-research [data-close]').click();
  for (const th of ['paper', 'ink', 'sand', 'sage', 'slate', 'dusk']) { q(`[data-themeopt="${th}"]`).click(); if (doc.documentElement.dataset.theme !== th) problems.push(`theme ${th} not applied`); }
  q('[data-themeopt="paper"]').click();
  // Tap to receive on each phone type: armed, tapped, walked to the end.
  for (const pf of ['android', 'ios_eea', 'ios']) {
    const pl = doc.getElementById('platform'); pl.value = pf; pl.dispatchEvent(new w.Event('change'));
    doc.getElementById('tab-recv').click(); freshRecv();
    q('#recv-steps [data-mode="set"]').click(); q('#recv-steps [data-unit="sats"]').click();
    const ra = q('#r-amount'); ra.value = '1000'; ra.dispatchEvent(new w.Event('input', { bubbles: true }));
    if (!q('#recv-steps #r-why') || !/Visible to/.test(q('#recv-steps .note')?.textContent || '')) problems.push(`no message on the amount step (${pf})`);
    q('#recv-steps [data-next]')?.click();
    // Offline, Lightning is disabled on every mint (global), so the tap carries ecash instead.
    (q('#recv-steps [data-rmethod="ln"]:not([disabled])') || q('#recv-steps [data-rmethod="creq"]'))?.click(); budget(`tap ${pf}`); q('[data-arm]')?.click();
    if (pf !== 'ios' && !q('[data-tapin]')) problems.push(`no tap on ${pf}`);
    // The message is asked before any quote or code exists, so it isn't on the QR step of a set amount.
    if (q('#recv-steps #r-why')) problems.push(`message asked after the invoice exists (${pf})`);
    q('[data-tapin]')?.click(); for (let n = 0; n < 5 && q('#recv-steps [data-tlnext]'); n++) q('#recv-steps [data-tlnext]').click(); budget(`tap receipt ${pf}`);
    q('#recv-steps [data-reset]')?.click();
  }
  { const pl = doc.getElementById('platform'); pl.value = 'android'; pl.dispatchEvent(new w.Event('change')); }
  doc.getElementById('tab-recv').click();
  // Any amount into a mint without BOLT12/onchain: the ways stay visible with "Works at" mints.
  { freshRecv(); q('#recv-steps [data-mode="any"]').click(); q('#recv-steps [data-mintmenu]')?.click(); q('#recv-steps [data-mintsel="minibits"]')?.click(); budget('any into kestrel');
    const lno = q('#recv-steps [data-only="lno"]');
    // Global: with tidewater down no mint issues BOLT12, so the tab is disabled. Mint-specific: tapping opens the picker.
    if (!air && down === 'sovran' && lno && !lno.disabled) problems.push('BOLT12 tab not disabled when no mint offers it');
    lno?.click(); budget('offer tab on kestrel');
    if (!air && down !== 'sovran' && !q('#recv-steps .dd-list')) problems.push('unsupported tab did not open the mint picker directly');
    if (!air && q('#recv-steps .dd-opt[data-mintsel="minibits"]:not([disabled])')) problems.push('mint without BOLT12 not disabled');
    q('#recv-steps .dd-opt[data-mintsel]:not([disabled]):not([data-mintsel=""])')?.click(); if (!air && down !== 'sovran' && q('#recv-steps .unsupported')) problems.push('still unsupported after changing mint');
    q('#recv-steps [data-mintmenu]')?.click(); q('#recv-steps [data-mintsel=""]')?.click(); }
  // Every sample token reaches a receipt (or its choice) within budget.
  for (const k of ['locked', 'plain', 'unknown', 'other']) {
    q('#recv-steps [data-go="0"]')?.click(); q('[data-reset]')?.click(); q('#recv-steps [data-mode="claim"]').click(); q(`[data-sampletoken="${k}"]`).click(); budget(`claim ${k}`);
    for (let n = 0; n < 5 && q('#recv-steps [data-tlnext]'); n++) { q('#recv-steps [data-tlnext]').click(); budget(`claim ${k} step ${n}`); }
    q('#recv-steps [data-reset]')?.click();
  }
  for (const m of ['any', 'set', 'claim']) { q('#recv-steps [data-go="0"]')?.click(); q(`#recv-steps [data-mode="${m}"]`).click(); budget(`receive ${m}`); }
  // A set amount through to the QR: each amount × each mint pin × each method.
  for (const amt of ['100', '30000']) for (const pin of ['', 'sovran', 'minibits', 'third']) {
    q('#recv-steps [data-go="0"]')?.click(); q('#recv-steps [data-mode="set"]').click(); q('#recv-steps [data-unit="sats"]').click();
    const i = q('#r-amount'); i.value = amt; i.dispatchEvent(new w.Event('input', { bubbles: true })); q('#recv-steps [data-next]')?.click();
    if (pin) { q('#recv-steps [data-mintmenu]')?.click(); q(`#recv-steps [data-mintsel="${pin}"]`)?.click(); }
    for (const mth of ['ln', 'creq', 'btc', 'all']) { q('#recv-steps [data-go="2"]')?.click(); const b = q(`#recv-steps [data-rmethod="${mth}"]`); if (b && !b.disabled) b.click(); budget(`receive ${amt} ${pin} ${mth}`); }
    q('#recv-steps [data-mintmenu]')?.click(); q('#recv-steps [data-mintsel=""]')?.click();
  }
}
// Every preset (flow.py PRESETS): no script errors, and nothing from a module that's off appears anywhere.
{
  const d = new JSDOM(html, { runScripts: 'dangerously' });
  const w = d.window, doc = w.document, q = (x) => doc.querySelector(x), qa = (x) => [...doc.querySelectorAll(x)];
  w.addEventListener('error', (e) => problems.push(`preset script error: ${e.message}`));
  const presets = [...doc.querySelectorAll('#preset option')].map((o) => o.value);
  if (presets.length < 6) problems.push('presets missing from the Wallet build card');
  for (const pr of presets) {
    const sel = doc.getElementById('preset'); sel.value = pr; sel.dispatchEvent(new w.Event('change'));
    const on = (m) => doc.getElementById(`mod-${m}`)?.checked;
    const P = (msg) => problems.push(`preset ${pr}: ${msg}`);
    // Send: Who, every entry, every paste example that is offered.
    doc.getElementById('tab-send').click();
    if (!on('nostr') && q('#send-steps [data-dd]')) P('people search shown without nostr');
    if (!on('ecash') && q('#send-steps [data-entry="token"]')) P('share token shown without ecash');
    if (!on('nfc') && q('#send-steps [data-entry="tap"]')) P('tap shown without nfc');
    q('#send-steps [data-entry="paste"]')?.click();
    const pastes = qa('#send-steps [data-paste]').map((b) => b.dataset.paste);
    if (!pastes.length) P('no paste examples');
    for (const v of pastes) {
      q('#send-steps [data-go="0"]')?.click(); q('#send-steps [data-entry="paste"]')?.click(); q(`#send-steps [data-paste="${v}"]`)?.click();
      if (q('#send-steps .lockbox') && !on('lock') && !q('#send-steps .lock-head')) P(`lock shown for ${v}`);
      const why = q('#s-why');
      if (why && /Visible to them: it goes with the ecash|whoever claims the token/.test(why.parentElement.textContent) && !on('msg_ecash')) P(`ecash message shown for ${v}`);
    }
    // Share a token: its message follows msg_ecash.
    if (on('ecash')) { q('#send-steps [data-go="0"]')?.click(); q('#send-steps [data-entry="token"]')?.click(); if (!!q('#s-why') !== !!on('msg_ecash')) P('token message field does not follow msg_ecash'); }
    // Receive: modes and the methods offered.
    doc.getElementById('tab-recv').click(); q('#recv-steps [data-reset]')?.click(); q('#recv-steps [data-go="0"]')?.click();
    if (!on('ecash') && q('#recv-steps [data-mode="claim"]')) P('paste a token shown without ecash');
    q('#recv-steps [data-mode="set"]').click(); q('#recv-steps [data-unit="sats"]').click();
    const i = q('#r-amount'); i.value = '30000'; i.dispatchEvent(new w.Event('input', { bubbles: true })); q('#recv-steps [data-next]')?.click();
    for (const [id, m] of [['ln', 'lightning'], ['creq', 'ecash'], ['btc', 'onchain']]) if (!on(m) && q(`#recv-steps [data-rmethod="${id}"]`)) P(`${id} tile shown without ${m}`);
    const rails = ['lightning', 'ecash', 'onchain'].filter(on).length;
    if (rails === 1 && q('#recv-steps [data-rmethod]')) P('a single-rail build still asks Get paid by');
    q('#recv-steps [data-rmethod]:not([disabled])')?.click();
    const qr = q('#recv-steps [data-qr]')?.dataset.qr || '';
    if (!on('ecash') && /CREQ/i.test(qr)) P('Cashu request in the QR without ecash');
    if (!on('nfc') && q('#recv-steps .tapbox')) P('tap box without nfc');
    q('#recv-steps [data-go="0"]')?.click(); q('#recv-steps [data-mode="any"]').click();
    for (const [id, m] of [['creq', 'ecash'], ['npc', 'npubcash'], ['lno', 'bolt12'], ['btc', 'onchain']]) if (!on(m) && q(`#recv-steps [data-only="${id}"]`)) P(`${id} tab shown without ${m}`);
  }
  // Dependencies hold: switching Lightning off also drops BOLT12 and npub.cash.
  const sel = doc.getElementById('preset'); sel.value = 'full'; sel.dispatchEvent(new w.Event('change'));
  const ln = doc.getElementById('mod-lightning'); ln.checked = false; ln.dispatchEvent(new w.Event('change', { bubbles: true }));
  if (doc.getElementById('mod-bolt12').checked || doc.getElementById('mod-npubcash').checked) problems.push('turning Lightning off left BOLT12 or npub.cash on');
}
if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1); }
console.log('concept page check passed');
