// Bun + installed Chrome only. Captures the actual rendered Astro/CSS scenes.
// Compare: bun scripts/visual.mjs
// Explicit geometry export: --export PATH --screenshots ios/wallet,ios/feed --preset duo-depth
// Website deliverables: node site/scripts/website-assets.mjs (from the repository root).
import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile,
  stat,
  readFile,
  readdir,
  rm,
  access,
  copyFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir, homedir, platform } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  CANVAS_FORMATS,
  SCENE_PRESETS,
  createScene,
} from "../../scripts/lib/phone-frame.mjs";
import { buildSourceCatalog } from "./source-catalog.mjs";
import { resolveCapture } from "./composition-recipe.mjs";
const site = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  assert(
    [
      "--export",
      "--preset",
      "--screenshots",
      "--poses",
      "--frames",
      "--live",
      "--format",
    ].includes(key),
    `Unknown argument: ${key}`,
  );
  assert(!Object.hasOwn(options, key), `Duplicate argument: ${key}`);
  if (["--frames", "--live"].includes(key))
    options[key] = true;
  else {
    assert(
      args[i + 1] && !args[i + 1].startsWith("--"),
      `${key} needs a value`,
    );
    options[key] = args[++i];
  }
}
const exporting = !!options["--export"];
assert(!options["--frames"] || !exporting, "--frames cannot export");
assert(!exporting || options["--screenshots"], "Explicit --screenshots required. Website OG: node site/scripts/website-assets.mjs");
assert(
  !options["--format"] || exporting,
  "--format requires an export",
);
assert(
  !options["--format"] || Object.hasOwn(CANVAS_FORMATS, options["--format"]),
  `Unknown canvas format: ${options["--format"]}`,
);
assert(
  !options["--format"] ||
    options["--preset"] ||
    options["--screenshots"],
  "--format requires --preset or --screenshots",
);
assert(!options["--preset"] || exporting, "--preset requires --export");
assert(
  !options["--poses"] || options["--screenshots"],
  "--poses requires --screenshots",
);
assert(
  !options["--screenshots"] || exporting,
  "--screenshots requires --export",
);
const output = exporting
  ? resolve(options["--export"])
  : await mkdtemp(join(tmpdir(), "site-restoration-"));
if (!output) throw new Error("Supply an export directory");
const screenshotFiles = (options["--screenshots"]?.split(',') ?? []).filter(key => /^ios\/[a-z0-9-]+$/.test(key));
const files = [
  "scripts/lib/phone-frame.mjs",
  "site/scripts/visual.mjs",
  "site/scripts/source-catalog.mjs",
  "site/scripts/website-config.mjs",
  "site/scripts/composition-recipe.mjs",
  "press/website.json",
  "site/scripts/verify-inputs.mjs",
  "site/src/components/PhoneScene.astro",
  "site/src/components/phone-scene.css",
  "site/src/lib/phoneGeometry.ts",
  "site/src/styles/site.css",
  "site/src/styles/dev.css",
  "site/src/layouts/Dev.astro",
  "site/src/pages/mockups.astro",
  "site/src/pages/screenshots.astro",
  "site/src/pages/scenes/[scene].astro",
  "site/src/pages/scenes/index.astro",
  "site/src/pages/scenes/custom.astro",
  "press/artwork/source/screenshots.json",
  "press/artwork/source/screenshot-context.json",
  "copy/src/site.ts",
  "site/public/sovran-mark.svg",
  ...["Regular", "Bold", "ExtraBold"].map(
    (weight) => `site/public/fonts/MonaSans/MonaSans-${weight}.ttf`,
  ),
  ...screenshotFiles.map(
    (file) => `press/artwork/source/screenshots/${file}.png`,
  ),
];
const inputHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(`${site}/../${file}`))
          .digest("hex"),
      ]),
    ),
  );
const inputs = exporting ? await inputHashes() : null;
const selectedKeys = options["--screenshots"]
  ?.split(",")
  .map((key) => key.trim());
const selectedPoses = options["--poses"]
  ? JSON.parse(options["--poses"])
  : undefined;
assert(
  !options["--poses"] || Array.isArray(selectedPoses),
  "--poses must be a JSON array",
);
assert(
  !selectedKeys || (selectedKeys.length >= 1 && selectedKeys.length <= 20),
  "Choose between 1 and 20 screenshots",
);
const selectedPreset =
  options["--preset"] ?? (selectedKeys ? "custom" : undefined);
const selectedFormat = options["--format"] ?? "native";
const sourceCatalog = exporting ? await buildSourceCatalog(resolve(site, '..')) : null;
const catalog = sourceCatalog ? {
  captures: Object.fromEntries(sourceCatalog.captures.filter(capture => capture.available && capture.freshness === 'current').map(capture => [capture.id, { ...capture, key: capture.id }])),
  missing: Object.fromEntries(sourceCatalog.captures.map(capture => [capture.id, capture.freshness])),
} : null;
const jobs = [];
if (selectedPreset) {
  assert(
    selectedPreset === "custom" || Object.hasOwn(SCENE_PRESETS, selectedPreset),
    `Unknown scene preset: ${selectedPreset}`,
  );
  const keys = selectedKeys;
  jobs.push({
    name: selectedKeys ? "custom" : selectedPreset,
    preset: selectedPreset,
    screenshots: keys,
    poses: selectedPoses,
    format: selectedFormat,
  });
}
for (const job of jobs) {
  const captures = job.screenshots.map((key) => {
    assert(
      Object.hasOwn(catalog.captures, key),
      `Unreviewed iOS screenshot: ${key}: ${catalog.missing[key] ?? "Not registered"}`,
    );
    return catalog.captures[key];
  });
  const scene = createScene(captures, { preset: job.preset, poses: job.poses });
  job.canvas = CANVAS_FORMATS[job.format] ?? {
    width: Math.ceil(scene.width),
    height: Math.ceil(scene.height),
  };
  job.provenance = captures;
}
if (exporting || options["--frames"]) {
  await mkdir(output, { recursive: true });
  const build = spawnSync(process.execPath, ["run", "build:internal"], {
    cwd: site,
    stdio: "inherit",
    timeout: 120000,
  });
  if (build.status !== 0)
    throw new Error("Scene export requires a successful current build");
}
const candidates = process.env.CHROME_PATH
  ? [process.env.CHROME_PATH]
  : [
      ...[
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "chrome",
      ].map((name) => Bun.which(name)),
      ...(platform() === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            join(
              homedir(),
              "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ),
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : []),
      ...(platform() === "win32"
        ? [
            process.env.PROGRAMFILES,
            process.env["PROGRAMFILES(X86)"],
            process.env.LOCALAPPDATA,
          ]
            .filter(Boolean)
            .map((dir) => join(dir, "Google/Chrome/Application/chrome.exe"))
        : []),
    ].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try {
    await access(candidate, constants.X_OK);
    executable = candidate;
    break;
  } catch {
    /* Try the next installed browser. */
  }
}
if (!executable)
  throw new Error(
    "Chrome/Chromium not found. Set CHROME_PATH to its executable.",
  );
const scratch = await mkdtemp(join(tmpdir(), "site-chrome-"));
const profile = join(scratch, "profile");
const staged = join(scratch, "artifacts");
await mkdir(staged);
const serve = (root, csp = false) =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      let path;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response("", { status: 400 });
      }
      if (path === "/releases/channels.json")
        return new Response("Unconfigured", { status: 503 });
      let file = resolve(root, `.${path}`);
      if (file !== resolve(root) && !file.startsWith(resolve(root) + sep))
        return new Response("", { status: 400 });
      try {
        if ((await stat(file)).isDirectory()) file += "/index.html";
      } catch {
        file += "/index.html";
      }
      if (!(await Bun.file(file).exists()))
        return new Response("Not found", { status: 404 });
      return new Response(
        Bun.file(file),
        csp
          ? {
              headers: {
                "Content-Security-Policy":
                  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'",
              },
            }
          : undefined,
      );
    },
  });
const current = serve(`${site}/${exporting || options["--frames"] ? '.astro/internal-dist' : 'dist'}`, true);
const original =
  exporting || options["--frames"]
    ? null
    : serve(
        fileURLToPath(new URL("../../../sovran.money/dist", import.meta.url)),
      );
const browser = spawn(
  executable,
  [
    "--headless=new",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
const pending = new Map();
const interrupt = () => {
  socket?.close();
  browser.kill("SIGTERM");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  const url = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(
      () => reject(new Error("Chrome startup timed out")),
      15000,
    );
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    browser.once("error", fail);
    browser.once("exit", (code) => fail(new Error(`Chrome exited: ${code}`)));
    browser.stderr.on("data", (chunk) => {
      text = (text + chunk).slice(-65536);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Chrome connection timed out")),
      15000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Chrome connection failed"));
      },
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        reject(new Error("Chrome connection closed"));
      },
      { once: true },
    );
  });
  let sequence = 0;
  socket.addEventListener("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Chrome disconnected"));
    }
    pending.clear();
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      clearTimeout(callback.timer);
      message.error
        ? callback.reject(message.error)
        : callback.resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome command timed out: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const call = (method, params) => send(method, params, sessionId);
  const browserVersion = await send("Browser.getVersion");
  await call("Page.enable");
  await call("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const settleImages = () =>
    evaluate(
      `Promise.all([document.fonts.ready, ...[...document.images].map(i => { i.loading = 'eager'; return i.decode(); }), ...[...document.querySelectorAll('image.phone-screen')].map(el => { const image = new Image(); image.src = el.getAttribute('href'); return image.decode(); })])`,
    );
  const navigate = async (url) => {
    await call("Page.navigate", { url });
    await Bun.sleep(700);
    await settleImages();
  };
  const capture = async (name, selector, expectedCanvas) => {
    const clip = selector
      ? await evaluate(
          `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 }; })()`,
        )
      : undefined;
    const image = await call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: !!clip,
      ...(clip ? { clip } : {}),
    });
    const bytes = Buffer.from(image.data, "base64");
    const canvas = {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
    if (expectedCanvas)
      assert.deepEqual(canvas, expectedCanvas, `${name}: exact PNG dimensions`);
    if ((exporting || expectedCanvas) && name !== "og") {
      const alpha = await evaluate(`(async () => {
        const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${image.data}`)};
        await image.decode();
         const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
         const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
         const edges = [context.getImageData(0, 0, image.width, 1), context.getImageData(0, image.height - 1, image.width, 1), context.getImageData(0, 0, 1, image.height), context.getImageData(image.width - 1, 0, 1, image.height)];
         return edges.every(edge => edge.data.every((value, index) => index % 4 !== 3 || value === 0));
       })()`);
      assert.equal(
        alpha,
        true,
        `${name}: scene export must have a transparent margin`,
      );
    }
    await writeFile(join(exporting ? staged : output, `${name}.png`), bytes);
    return canvas;
  };
  const checkPhones = async () => {
    const checks =
      await evaluate(`([document, ...[...document.querySelectorAll('iframe')].map(frame => frame.contentDocument).filter(Boolean)].flatMap(doc => [...doc.querySelectorAll('.phone-scene')].map(scene => {
      const stage = scene.querySelector('.phone-stage').getBoundingClientRect();
      const exportBounds = scene.closest('.export-scene')?.getBoundingClientRect();
      const caption = scene.querySelector('figcaption')?.getBoundingClientRect();
      const phones = [...scene.querySelectorAll('.phone-model')].map(phone => {
        const r = phone.getBoundingClientRect();
        const screen = phone.querySelector('.phone-screen');
         const clip = doc.querySelector(screen.getAttribute('clip-path').slice(4, -1)).firstElementChild;
        const w = screen.width.baseVal.value, h = screen.height.baseVal.value;
        const radius = Number(screen.dataset.radius);
        return {
          fits: r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom,
          fitsExport: !exportBounds || (r.left >= exportBounds.left && r.right <= exportBounds.right && r.top >= exportBounds.top && r.bottom <= exportBounds.bottom),
          clearCaption: !caption || caption.top - r.bottom >= 12,
          ratio: Math.abs(w / h - Number(screen.dataset.sourceWidth) / Number(screen.dataset.sourceHeight)) < .000001,
          wholeImage: screen.getAttribute('preserveAspectRatio') === 'none' && Number(screen.dataset.sourceHeight) > Number(screen.dataset.sourceWidth),
          iosOnly: phone.dataset.platform === 'ios',
          continuous: !clip.isPointInFill(new DOMPoint(0, 0)) && !clip.isPointInFill(new DOMPoint(radius * .1, radius * .1)) && clip.isPointInFill(new DOMPoint(radius * .5, radius * .5)) && clip.isPointInFill(new DOMPoint(w / 2, 1)) && clip.isPointInFill(new DOMPoint(w / 2, h - 1)),
          layers: phone.querySelectorAll('.phone-shell').length
        };
      });
      return { scene: scene.dataset.scene, phones };
    })))`);
    for (const { scene, phones } of checks)
      for (const check of phones) {
        for (const field of [
          "fits",
          "fitsExport",
          "clearCaption",
          "ratio",
          "wholeImage",
          "continuous",
          "iosOnly",
        ])
          assert.equal(check[field], true, `${scene}: ${field}`);
        assert.equal(check.layers, 65, `${scene}: physical extrusion`);
      }
    return checks;
  };
  if (exporting) {
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    const exportJobs = jobs;
    const records = {};
    for (const job of exportJobs) {
      const custom = !!job.screenshots;
      const query = custom
        ? `?${new URLSearchParams({ preset: job.preset, export: "1", format: job.format, screenshots: job.screenshots.join(","), ...(job.poses ? { poses: JSON.stringify(job.poses) } : {}) })}`
        : "";
      await call("Emulation.setDeviceMetricsOverride", {
        width: job.canvas?.width ?? 1200,
        height: job.canvas?.height ?? 1200,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await navigate(
        `http://127.0.0.1:${current.port}/scenes/${custom ? "custom" : job.name}/${query}`,
      );
      if (custom)
        assert.equal(
          await evaluate(
            'document.querySelector("[data-custom-scene]").dataset.ready',
          ),
          "true",
          "Custom scene rejected",
        );
      assert.equal(
        await evaluate(
          "[...document.images].every(i => i.complete && i.naturalWidth > 0)",
        ),
        true,
      );
      const phoneCount = await evaluate(
        'document.querySelectorAll(".phone-model").length',
      );
      assert(phoneCount > 0, `${job.name}: missing-input scenes cannot export`);
      if (custom) assert.equal(phoneCount, job.screenshots.length);
      if (custom)
        assert.equal(
          await evaluate("document.documentElement.scrollWidth <= innerWidth"),
          true,
          `${job.name}: export overflow`,
        );
      await checkPhones();
      const canvas = await capture(
        job.name,
        ".export-scene",
        job.canvas ??
          (job.name === "og" ? { width: 1200, height: 630 } : undefined),
      );
      records[`${job.name}.png`] = {
        ...job,
        format: job.format ?? (job.name === "og" ? "landscape" : "page-bounds"),
        canvas,
      };
      console.log(`Staged ${job.name}.png (${canvas.width}x${canvas.height})`);
    }
    assert.deepEqual(
      await inputHashes(),
      inputs,
      "Scene inputs changed during export; rebuild and retry",
    );
    const images = {};
    for (const job of exportJobs)
      images[`${job.name}.png`] = createHash("sha256")
        .update(await readFile(join(staged, `${job.name}.png`)))
        .digest("hex");
    let previous = null;
    try {
      previous = JSON.parse(
        await readFile(join(output, "manifest.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      previous &&
      Object.keys(previous.images).some((name) => !Object.hasOwn(images, name))
    ) {
      assert.deepEqual(
        previous.inputs,
        inputs,
        "Other scenes in this destination would become stale. Regenerate all scenes together, or use a separate OG-only destination.",
      );
    }
    for (const name of Object.keys(images)) {
      try {
        const existing = await readFile(join(output, name));
        assert.equal(
          createHash("sha256").update(existing).digest("hex"),
          previous?.images?.[name],
          `Refusing to overwrite an unrecognized or edited output: ${name}`,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (const name of Object.keys(images))
      await copyFile(join(staged, name), join(output, name));
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify(
        {
          renderer:
            "Chrome, shared continuous-corner parallel-offset extrusion with actual iOS screenshots",
          browser: browserVersion,
          selection: {
            preset: selectedPreset ?? "all",
            screenshots: selectedKeys ?? null,
            poses: selectedPoses ?? null,
            format: selectedFormat,
          },
          inputs,
          exports: { ...previous?.exports, ...records },
          images: { ...previous?.images, ...images },
        },
        null,
        2,
      ),
    );
  } else if (options["--frames"]) {
    const evidence = [];
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
      [320, 780],
    ]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      for (const route of [
        "",
        "scenes",
        ...Object.keys(SCENE_PRESETS).map((key) => `scenes/${key}`),
        "scenes/custom",
        "roadmap",
        "releases",
        "dev",
        "mockups",
      ]) {
        await navigate(`http://127.0.0.1:${current.port}/${route}`);
        assert.equal(
          await evaluate("document.documentElement.scrollWidth <= innerWidth"),
          true,
          `Overflow: ${route} at ${width}`,
        );
        evidence.push({ route, width, geometry: await checkPhones() });
        if (!route.startsWith("scenes/") || route === "scenes/custom")
          await capture(
            `frames-${route.replaceAll("/", "-") || "home"}-${width}`,
            "body",
          );
      }
      await navigate(`http://127.0.0.1:${current.port}/mockups`);
      const selection = await evaluate(`(() => ({
        recipes: document.querySelectorAll('a[href^="/social#recipe="]').length,
        status: document.querySelector('[role=status]').textContent,
        frames: document.querySelectorAll('iframe').length,
      }))()`);
      assert.equal(selection.recipes, 1, 'Only the selected OG recipe is listed');
      assert.equal(selection.frames, 0, 'Website assets do not eagerly render a batch of previews');
      assert.match(selection.status, /Blocked:|Current:|Needs regeneration:/);
      evidence.push({ route: 'mockups', width, selection });
      await navigate(`http://127.0.0.1:${current.port}/scenes/custom`);
      for (const format of Object.keys(CANVAS_FORMATS)) {
        await evaluate(`(() => {
          const form = document.querySelector('.scene-editor');
          form.elements.preset.value = 'duo-depth';
          form.elements.preset.dispatchEvent(new Event('change', { bubbles: true }));
           const slots = form.querySelectorAll('[name=screen]'); slots[0].value = 'ios/wallet'; slots[1].value = 'ios/feed';
          form.elements.format.value = ${JSON.stringify(format)}; form.requestSubmit();
        })()`);
        await settleImages();
        assert.equal(
          await evaluate(
            'document.querySelector("[data-custom-scene]").dataset.ready',
          ),
          "true",
        );
        assert.equal(
          await evaluate("document.documentElement.scrollWidth <= innerWidth"),
          true,
          `Custom ${format} overflow at ${width}`,
        );
        assert.equal(
          await evaluate('new URL(location.href).searchParams.get("format")'),
          format,
        );
        evidence.push({
          route: "scenes/custom",
          width,
          format,
          geometry: await checkPhones(),
        });
        await capture(`frames-custom-${format}-${width}`, "body");
      }
      await evaluate(`(() => {
        const form = document.querySelector('.scene-editor');
        form.elements.preset.value = 'custom'; form.elements.preset.dispatchEvent(new Event('change', { bubbles: true }));
        form.elements.count.value = '3'; form.elements.count.dispatchEvent(new Event('change', { bubbles: true }));
        form.requestSubmit();
      })()`);
      assert.equal(
        await evaluate('document.querySelectorAll(".phone-model").length'),
        3,
        "Custom phone-count interaction",
      );
      await checkPhones();
      await evaluate(
        `(() => { const form = document.querySelector('.scene-editor'); form.elements.poses.value = '[{}]'; form.requestSubmit(); })()`,
      );
      assert.equal(
        await evaluate(
          'document.querySelector("[data-custom-scene]").dataset.ready',
        ),
        "false",
        "Invalid poses fail closed",
      );
      assert.equal(
        await evaluate('document.querySelectorAll(".phone-model").length'),
        0,
      );
      assert.equal(
        await evaluate(
          'document.querySelector("[data-export-command]").textContent',
        ),
        "",
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const frameCatalog = await buildSourceCatalog(resolve(site, '..'));
    const frameScreenshots = ["ios/wallet", "ios/feed"];
    const frameScene = createScene(
      frameScreenshots.map((key) => ({ ...resolveCapture(frameCatalog, key), key })),
      { preset: "duo-depth" },
    );
    await call("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    for (const [format, size] of Object.entries(CANVAS_FORMATS)) {
      const canvas = size ?? {
        width: Math.ceil(frameScene.width),
        height: Math.ceil(frameScene.height),
      };
      await call("Emulation.setDeviceMetricsOverride", {
        ...canvas,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const query = new URLSearchParams({
        preset: "duo-depth",
        screenshots: frameScreenshots.join(","),
        format,
        export: "1",
      });
      await navigate(
        `http://127.0.0.1:${current.port}/scenes/custom/?${query}`,
      );
      assert.equal(
        await evaluate(
          'document.querySelector("[data-custom-scene]").dataset.ready',
        ),
        "true",
      );
      evidence.push({
        route: "scenes/custom",
        export: true,
        format,
        canvas,
        geometry: await checkPhones(),
      });
      await capture(`frames-export-${format}`, ".export-scene", canvas);
    }
    await call("Emulation.setDefaultBackgroundColorOverride", {});
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(
      `http://127.0.0.1:${current.port}/scenes/custom/?preset=single-front&screenshots=ios%2Fwallet`,
    );
    assert.equal(
      await evaluate(
        'document.querySelector("[data-custom-scene]").dataset.ready',
      ),
      "true",
    );
    await capture("frames-wallet-front", ".phone-stage");
    const closeup = await evaluate(
      `(() => { const p = document.querySelector('.phone-screen'); const m = p.getScreenCTM(); const a = new DOMPoint(-24, -24).matrixTransform(m); const b = new DOMPoint(160, 140).matrixTransform(m); return { x: a.x + scrollX, y: a.y + scrollY, width: b.x - a.x, height: b.y - a.y, scale: 2 }; })()`,
    );
    const image = await call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: closeup,
    });
    await writeFile(
      join(output, "frames-corner-closeup.png"),
      Buffer.from(image.data, "base64"),
    );
    for (const query of [
      "screenshots=android%2Fwallet",
      "screenshots=ios%2Fnot-registered",
      "format=not-a-format",
      ...["ios/settings-keyring", "ios/receive-qr-p2pk"]
        .map((key) => `screenshots=${encodeURIComponent(key)}`),
    ]) {
      await navigate(
        `http://127.0.0.1:${current.port}/scenes/custom/?${query}`,
      );
      assert.equal(
        await evaluate(
          'document.querySelector("[data-custom-scene]").dataset.ready',
        ),
        "false",
        `Invalid input must fail closed: ${query}`,
      );
      assert.equal(
        await evaluate('document.querySelectorAll(".phone-model").length'),
        0,
      );
      assert.equal(
        await evaluate(
          'document.querySelector("[data-export-command]").textContent',
        ),
        "",
      );
      assert.equal(
        await evaluate(
          'document.querySelector("[data-share]").hasAttribute("href")',
        ),
        false,
      );
      evidence.push({ rejected: query });
    }
    await writeFile(
      join(output, "checks.json"),
      JSON.stringify(evidence, null, 2),
    );
  } else {
    const evidence = [];
    for (const [name, server, path] of [
      ["original", original, "/en/"],
      ["restored", current, "/"],
    ]) {
      for (const [width, height] of [
        [1440, 1000],
        [390, 844],
        ...(name === "restored" ? [[320, 780]] : []),
      ]) {
        await call("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await navigate(
          name === "original" && process.argv.includes("--live")
            ? "https://sovran.money/en/"
            : `http://127.0.0.1:${server.port}${path}`,
        );
        await capture(`${name}-${width}`);
        await capture(`${name}-${width}-full`, "body");
        if (name === "restored") {
          assert.equal(
            await evaluate(
              "document.documentElement.scrollWidth <= innerWidth",
            ),
            true,
            `Overflow at ${width}`,
          );
          assert.equal(
            await evaluate(
              "[...document.images].every(i => i.complete && i.naturalWidth > 0)",
            ),
            true,
            `Images at ${width}`,
          );
          evidence.push({ width, geometry: await checkPhones() });
          for (const section of [
            "wallet",
            "social",
            "ai",
            "offline",
            "stack",
            "faq",
            "download",
          ])
            await capture(`${name}-${width}-${section}`, `#${section}`);
          await evaluate('document.querySelector(".faq-list summary").click()');
          assert.equal(
            await evaluate('document.querySelector(".faq-list details").open'),
            true,
          );
          assert.equal(
            await evaluate(
              'document.querySelectorAll("a[data-action][href]").length',
            ),
            0,
            "Unconfigured downloads fail closed",
          );
          if (width === 390) {
            await evaluate(
              'document.querySelector(".mobile-nav summary").click()',
            );
            assert.equal(
              await evaluate('document.querySelector(".mobile-nav").open'),
              true,
            );
            await capture("restored-mobile-menu");
          }
          evidence.push(
            await evaluate(
              `({ width: innerWidth, overflow: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector('h1')).fontFamily, sections: [...document.querySelectorAll('main > section[id]')].map(e => e.id), images: document.images.length })`,
            ),
          );
        }
      }
    }
    await writeFile(`${output}/checks.json`, JSON.stringify(evidence, null, 2));
  }
  console.log(`Rendered evidence: ${output}`);
} finally {
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  current.stop(true);
  original?.stop(true);
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        browser.kill("SIGKILL");
        resolve();
      }, 2000);
      browser.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  browser.stderr.destroy();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  // Only the directory allocated by this invocation is removed. Evidence and
  // requested export destinations are never recursively deleted.
  await rm(scratch, { recursive: true, force: true });
}
