import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  composeBrand,
  composeAndroidAdaptive,
  loadBrandInputs,
  rasterizeBrand,
} from "./brand-assets.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const sharp = require("sharp");
const inputs = await loadBrandInputs();
const near = (actual, expected, tolerance = 0.000003) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("every layout uses one canonical S with uniform scaling and equal ink margins", () => {
  for (const layout of Object.keys(inputs.config.layouts)) {
    for (const theme of Object.keys(inputs.config.themes)) {
      const drawing = composeBrand(inputs, layout, theme);
      assert(drawing.raw.includes(`d="${inputs.mark.d}"`));
      const [mark, text] = drawing.bounds;
      near(mark.width / mark.height, inputs.mark.width / inputs.mark.height);
      if (layout === "wordmark-lockup") {
        near(mark.x, drawing.width - text.x - text.width);
        near(mark.y + mark.height / 2, drawing.height / 2);
        near(text.y + text.height / 2, drawing.height / 2);
        near(
          text.x - mark.x - mark.width,
          inputs.config.layouts["wordmark-lockup"].gap,
        );
      } else {
        near(mark.x + mark.width / 2, drawing.width / 2);
        if (text) {
          near(text.x + text.width / 2, drawing.width / 2);
          near(mark.y, drawing.height - text.y - text.height);
          near(
            text.y - mark.y - mark.height,
            inputs.config.layouts["version-lockup"].gap,
          );
        } else near(mark.y + mark.height / 2, drawing.height / 2);
      }
    }
  }
});

test("version artwork follows the product version and fits longer versions without changing the S", () => {
  const current = composeBrand(inputs, "version-lockup", "black-on-light");
  const next = composeBrand(
    inputs,
    "version-lockup",
    "black-on-light",
    "12.345.6789",
  );
  assert.equal(current.version, inputs.version);
  assert.equal(next.version, "12.345.6789");
  assert.notEqual(current.svg, next.svg);
  near(current.bounds[0].height, next.bounds[0].height);
  assert(
    next.bounds[1].width <=
      inputs.config.layouts["version-lockup"].textMaxWidth,
  );
  assert(!next.svg.includes("<text"));
  assert(!next.svg.includes("NaN"));
  for (const invalid of ["1.2", "01.2.3", "1.2.3<script>", "1.2.3-rc.1"]) {
    assert.throws(
      () => composeBrand(inputs, "version-lockup", "black-on-light", invalid),
      /Invalid product version/,
    );
  }
});

test("SVGO preserves the composed artwork when rasterized at 1024px and 2048px", async () => {
  for (const layout of Object.keys(inputs.config.layouts)) {
    for (const theme of Object.keys(inputs.config.themes)) {
      const drawing = composeBrand(inputs, layout, theme);
      assert(drawing.svg.length < drawing.raw.length);
      assert(!/<(?:filter|text|script|image|use)\b/.test(drawing.svg));
      for (const width of [1024, 2048]) {
        const height = Math.round((width * drawing.height) / drawing.width);
        const raw = await rasterizeBrand(drawing.raw, width, height, false);
        const optimized = await rasterizeBrand(
          drawing.svg,
          width,
          height,
          false,
        );
        const a = await sharp(raw)
          .flatten({ background: "#888" })
          .raw()
          .toBuffer();
        const b = await sharp(optimized)
          .flatten({ background: "#888" })
          .raw()
          .toBuffer();
        assert.equal(a.length, b.length);
        let squared = 0;
        for (let i = 0; i < a.length; i++) squared += (a[i] - b[i]) ** 2;
        const rmse = Math.sqrt(squared / a.length);
        assert(
          rmse < 0.2,
          `${layout}/${theme}/${width} SVG optimization pixel RMSE ${rmse}`,
        );
      }
    }
  }
});

test("fixed pixel exports have correct dimensions, opacity and identical transparent silhouettes", async () => {
  for (const layout of Object.keys(inputs.config.layouts)) {
    const height = (size) =>
      layout === "wordmark-lockup" ? Math.round((size * 3) / 8) : size;
    for (const size of inputs.config.sizes) {
      let alpha;
      for (const [theme, colors] of Object.entries(inputs.config.themes)) {
        const file = new URL(
          `../app/assets/brand/generated/${layout}/${theme}/${size}x${height(size)}.png`,
          import.meta.url,
        );
        const png = await readFile(file);
        const metadata = await sharp(png).metadata();
        assert.equal(metadata.width, size);
        assert.equal(
          metadata.height,
          layout === "wordmark-lockup" ? Math.round((size * 3) / 8) : size,
        );
        assert.equal(metadata.hasAlpha, !colors.background);
        if (!colors.background) {
          const current = await sharp(png)
            .extractChannel("alpha")
            .raw()
            .toBuffer();
          assert(current.some((value) => value === 0));
          assert(current.some((value) => value > 0));
          if (alpha)
            assert(
              current.equals(alpha),
              `${layout}/${size}: transparent silhouettes differ`,
            );
          alpha = current;
        }
      }
    }
  }
});

test("Android adaptive artwork stays inside the circular launcher safe zone", async () => {
  const drawing = composeAndroidAdaptive(inputs);
  assert(drawing.raw.includes(`d="${inputs.mark.d}"`));
  const png = await readFile(
    new URL(
      "../app/assets/brand/generated/android-adaptive-icon/black-on-transparent/1024x1024.png",
      import.meta.url,
    ),
  );
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  const radius = (1024 * 33) / 108;
  let ink = 0;
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++) {
      if (data[(y * 1024 + x) * 4 + 3] > 0) {
        ink++;
        assert(
          Math.hypot(x + 0.5 - 512, y + 0.5 - 512) < radius,
          "Foreground clipped by safe-zone mask",
        );
      }
    }
  assert(ink > 10000);
});
