// Explicit integration gate: node --test site/scripts/composition-browser.test.mjs
// Uses an isolated Astro dev server and installed Chrome, never the user's server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dev } from '../node_modules/astro/dist/index.js';

test('local workbench browser: responsive pages, source downloads, draft rendering, controls and URL restoration', { timeout: 120000 }, async t => {
  const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { await access(chrome); } catch { t.skip('Installed Chrome unavailable; set CHROME_PATH.'); return; }
  const scratch = await mkdtemp(join(tmpdir(), 'sovran-workbench-'));
  t.diagnostic(`Visual evidence directory: ${scratch}`);
  const server = await dev({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', devToolbar: { enabled: false } });
  const origin = `http://127.0.0.1:${server.address.port}`;
  const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-sync', '--remote-debugging-port=0', `--user-data-dir=${scratch}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  t.after(async () => { socket?.close(); browser.kill('SIGTERM'); browser.stderr.destroy(); browser.unref(); await server.stop(); });
  const ws = await new Promise((resolve, reject) => {
    let text = ''; browser.on('error', reject);
    browser.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
  });
  socket = new WebSocket(ws);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  const pending = new Map(), exceptions = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable');
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,1200)')}`);
  };
  const shot = async name => {
    const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(scratch, `${name}.png`), Buffer.from(capture.data, 'base64'));
  };
  for (const [page, ready] of [['dev', 'document.querySelector(".workbench-index")'], ['screenshots', 'document.querySelector(".capture-group")'], ['logos', 'document.querySelector(".logo-variant")'], ['social', 'document.querySelector(".concept-card")']]) {
    assert.equal((await fetch(`${origin}/${page}`)).status, 200);
    await call('Page.navigate', { url: `${origin}/${page}` }); await wait(ready);
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 780]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await new Promise(resolve => setTimeout(resolve, 150));
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${page} overflow at ${width}`);
      await shot(`${page}-${width}`);
    }
    if (page === 'screenshots') {
      assert(await evaluate('document.querySelector("#catalog-status").textContent.includes("202 / 202 canonical baseline slots")'));
      assert(await evaluate('document.querySelector(".capture-attempt-evidence").textContent.includes("Plan:")'));
      await evaluate('document.querySelector("#capture-attempt").value="blocked";document.querySelector("#capture-attempt").dispatchEvent(new Event("input"))');
      assert(await evaluate('[...document.querySelectorAll(".capture-group")].every(g=>g.textContent.includes("Capture attempt: blocked"))'));
      await evaluate('document.querySelector("#capture-attempt").value="";document.querySelector("#capture-attempt").dispatchEvent(new Event("input"))');
      await evaluate('document.querySelector("#capture-drafts").click()');
      await wait('document.querySelector(".capture-source a[download]")');
      assert(await evaluate('[...document.querySelectorAll(".capture-source a[download]")].every(a=>/draft-|source-matched-native-unverified/.test(a.download))'));
      assert(await evaluate('[...document.images].every(i=>i.loading==="lazy")'));
    }
    if (page === 'logos') {
      assert(await evaluate('[...document.querySelectorAll(".logo-variant select")].every(s=>{const n=[...s.options].map(o=>parseInt(o.text));return n.every((v,i)=>!i||v>=n[i-1])})'));
      assert(await evaluate('[...document.querySelectorAll("a[download]")].some(a=>a.download.endsWith(".svg"))'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector("#gallery-draft").click(); document.querySelector("#concept-gallery").scrollIntoView({behavior:"instant"})');
  await wait('document.querySelector(".concept-preview img")?.complete');
  await shot('social-gallery-drafts');
  await evaluate('document.querySelector(".concept-card button").click(); document.querySelector("#composition-form").requestSubmit()');
  await wait('!document.querySelector("#download-composition").hidden');
  assert(await evaluate('document.querySelector("#composition-preview img").src === document.querySelector("#download-composition").href'));
  assert(await evaluate('document.querySelector("#download-composition").download.startsWith("draft-")'));
  await shot('social-render-desktop');
  await evaluate('const h=document.querySelector("#headline");h.value="First edit";h.dispatchEvent(new Event("input"));h.value="Second edit";h.dispatchEvent(new Event("input"));');
  assert(await evaluate('document.querySelector("#download-composition").hidden'));
  await evaluate('const p=document.querySelector("#phone-controls select");p.value="android";p.dispatchEvent(new Event("change")); const n=document.querySelector("#phone-controls input[type=number]");n.value="50";n.dispatchEvent(new Event("input"));n.value="60";n.dispatchEvent(new Event("input"));');
  const hash = await evaluate('location.hash');
  const recipe = JSON.parse(decodeURIComponent(hash.slice(8)));
  assert.equal(recipe.headline, 'Second edit'); assert(recipe.phones[0].captureId.startsWith('android/')); assert.equal(recipe.phones[0].pose.x, 60);
  await evaluate(`{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify({ ...recipe, title: 'Imported recipe' }))}], 'recipe.json', {type:'application/json'}));const input=document.querySelector('#import-recipe');input.files=transfer.files;input.dispatchEvent(new Event('change'));}`);
  await wait('document.querySelector("#recipe-title").value === "Imported recipe"');
  await evaluate('window.__workbenchReloadProbe = true');
  await call('Page.reload');
  await wait('!window.__workbenchReloadProbe && document.querySelector("#headline")?.value === "Second edit"');
  assert(await evaluate('document.querySelector("#recipe-title").value === "Imported recipe"'));
  assert(await evaluate('document.querySelector("#phone-controls select").value === "android"'));
  await evaluate('document.querySelector("#composition-form").requestSubmit()');
  await wait('!document.querySelector("#download-composition").hidden');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector(".composition-output").scrollIntoView({behavior:"instant"})');
  await new Promise(resolve => setTimeout(resolve, 150)); await shot('social-render-mobile');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  t.diagnostic(`HTTP and browser checks passed. Visual evidence: ${scratch}`);
});
