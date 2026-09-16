import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  captureDevice,
  continuousPath,
  phoneGeometry,
  createScene,
  renderPhone,
  SCENE_PRESETS,
} from "../../scripts/lib/phone-frame.mjs";

test("the app smoothing construction joins four identical continuous corners", () => {
  const path = continuousPath(402, 874, 62);
  expect(path).toStartWith("M 302.8 0");
  expect((path.match(/\bc /g) ?? []).length).toBe(8);
  expect((path.match(/\ba 62 62 /g) ?? []).length).toBe(4);
  expect(path).not.toMatch(/NaN|Infinity/);
  expect(path.trim()).toEndWith("Z");
  expect(() => continuousPath(0, 874, 62)).toThrow();
});

test("retained Pro and Pro Max captures use their actual logical dimensions and 62pt radius", () => {
  const folder = new URL(
    "../../press/artwork/source/screenshots/ios/",
    import.meta.url,
  );
  for (const name of readdirSync(folder)) {
    const bytes = readFileSync(new URL(name, folder));
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    const phone = phoneGeometry(width, height);
    expect(phone.screenWidth / phone.screenHeight).toBeCloseTo(
      width / height,
      12,
    );
    expect(phone.radius).toBe(62);
    expect(phone.screenHeight).toBe(height / 3);
    expect(phone.corners.length).toBe(8);
  }
  expect(captureDevice("ios", 1320, 2868).id).toBe("iphone-17-pro-max");
  expect(captureDevice("ios", 1206, 2622).id).toBe("iphone-17-pro");
  const ptPerMm = 460 / 25.4 / 3;
  for (const [w, h, mmW, mmH] of [
    [1206, 2622, 71.9, 150],
    [1320, 2868, 78, 163.4],
  ]) {
    const device = captureDevice("ios", w, h);
    expect(
      Math.abs((device.width + 2 * device.bezel) / ptPerMm - mmW),
    ).toBeLessThan(0.1);
    expect(
      Math.abs((device.height + 2 * device.bezel) / ptPerMm - mmH),
    ).toBeLessThan(0.1);
    expect(device.thickness / ptPerMm).toBeCloseTo(8.75, 12);
  }
  const android = captureDevice("android", 1080, 2400);
  expect(android.radius).toBe(0);
  expect([android.width, android.height]).toEqual([360, 800]);
  for (const dimensions of [
    [2868, 1320],
    [1080, 1920],
    [0, 0],
    [Infinity, 2622],
  ])
    expect(() => captureDevice("ios", ...dimensions)).toThrow();
  // Store-delivery geometry (Play rejects ratios above 2:1) is not a second
  // framing body: it must be recaptured on library-v1, never drawn beside it.
  for (const dimensions of [
    [1080, 1920],
    [2400, 1080],
    [1320, 2868],
  ])
    expect(() => captureDevice("android", ...dimensions)).toThrow();
});

test("projection agrees with an independent three-axis rotation, including whole-device quarter turns", () => {
  for (const rotateX of [-60, 0, 30])
    for (const rotateY of [-55, 0, 45])
      for (const rotateZ of [-90, 0, 12, 90, 180, 270]) {
        const phone = phoneGeometry(1206, 2622, {
          x: 12,
          y: 34,
          rotateX,
          rotateY,
          rotateZ,
          scale: 0.7,
        });
        const radians = (d: number) => (d * Math.PI) / 180;
        const rx = radians(rotateX),
          ry = radians(rotateY),
          rz = radians(rotateZ);
        for (const [x, y, z] of [
          [0, 0, 0],
          [402, 874, -24],
          [201, 437, -12],
        ]) {
          const ux = x - 201,
            uy = y - 437;
          const vy = uy * Math.cos(rx) - z * Math.sin(rx),
            vz = uy * Math.sin(rx) + z * Math.cos(rx);
          const vx = ux * Math.cos(ry) + vz * Math.sin(ry);
          const expected = {
            x: 12 + 0.7 * (201 + vx * Math.cos(rz) - vy * Math.sin(rz)),
            y: 34 + 0.7 * (437 + vx * Math.sin(rz) + vy * Math.cos(rz)),
          };
          expect(phone.project(x, y, z).x).toBeCloseTo(expected.x, 10);
          expect(phone.project(x, y, z).y).toBeCloseTo(expected.y, 10);
        }
      }
});

test("bezel and chassis are uniform outward offsets of the exact display path, never overlays", () => {
  const phone = phoneGeometry(1206, 2622, { rotateY: -20 });
  const svg = renderPhone(phone, {
    id: "test",
    href: "/capture.png",
    alt: 'A "screen" <test>',
  });
  const paths = [
    ...svg.matchAll(
      /<use class="[^"]*" href="([^"]+)"[^>]*stroke-width="([^"]+)"/g,
    ),
  ];
  expect(paths.length).toBe(67);
  expect(paths.every((match) => match[1] === "#test-contour")).toBe(true);
  expect(svg).toContain(`<path id="test-contour" d="${phone.screen}"`);
  expect(Number(paths.at(-2)![2])).toBe(phone.bezel * 2);
  expect(Number(paths.at(-1)![2])).toBeCloseTo((phone.bezel - 1) * 2, 10);
  // Rounded sidewalls stay inside the calibrated chassis; only the narrow rim is lighter.
  for (const path of paths.slice(0, 65))
    expect(Number(path[2])).toBeLessThanOrEqual(phone.bezel * 2);
  const metal = svg.match(
    /<linearGradient id="test-metal"[^>]*>(.*?)<\/linearGradient>/,
  )![1];
  expect(
    [...metal.matchAll(/stop-color="#([\da-f]{6})"/g)].every(([, hex]) =>
      [0, 2, 4].every(
        (offset) => parseInt(hex.slice(offset, offset + 2), 16) < 96,
      ),
    ),
  ).toBe(true);
  expect(svg).toContain("A &quot;screen&quot; &lt;test&gt;");
  expect(svg).not.toMatch(
    /<rect|<foreignObject|opacity=|island|camera|object-fit/,
  );
  expect(svg.slice(svg.indexOf("<image"))).not.toContain("<path");
  expect(svg).toContain('clipPathUnits="userSpaceOnUse"');
  expect(() =>
    renderPhone(phone, { id: 'bad"', href: "/capture.png" }),
  ).toThrow();
  expect(() =>
    renderPhone(phone, { id: "test", href: "https://example.com/capture.png" }),
  ).toThrow();
});

const capture = { key: "ios/wallet", width: 1320, height: 2868 };
const proCapture = { key: "ios/feed", width: 1206, height: 2622 };
const mixedCaptures = (n: number, reversed = false) =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === Number(reversed) ? proCapture : capture,
  );

const chassisBounds = (phone: ReturnType<typeof phoneGeometry>) => {
  const topLeft = phone.project(-phone.bezel, -phone.bezel);
  const bottomRight = phone.project(
    phone.width + phone.bezel,
    phone.height + phone.bezel,
  );
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
};

test("mixed native captures normalize chassis height in either order without changing source ratios", () => {
  for (const reversed of [false, true]) {
    const inputs = mixedCaptures(2, reversed);
    const { phones } = createScene(inputs, { preset: "duo-front" });
    expect(
      (phones[0].height + 2 * phones[0].bezel) * phones[0].scale,
    ).toBeCloseTo(
      (phones[1].height + 2 * phones[1].bezel) * phones[1].scale,
      10,
    );
    phones.forEach((phone, i) => {
      expect(phone.screenWidth).toBe(inputs[i].width / 3);
      expect(phone.screenHeight).toBe(inputs[i].height / 3);
      expect(phone.screenWidth / phone.screenHeight).toBeCloseTo(
        inputs[i].width / inputs[i].height,
        12,
      );
      const origin = phone.project(0, 0);
      expect(
        (phone.project(phone.width, 0).x - origin.x) /
          (phone.project(0, phone.height).y - origin.y),
      ).toBeCloseTo(inputs[i].width / inputs[i].height, 12);
    });
  }
});

test("front rows, default custom rows, and grids have measured equal gaps and baselines", () => {
  for (const reversed of [false, true])
    for (const [preset, count] of [
      ["duo-front", 2],
      ["triple-row", 3],
      ["quartet-side-by-side", 4],
      ["quartet-grid", 4],
      ["custom", 7],
    ] as const) {
      const inputs = mixedCaptures(count, reversed);
      if (preset === "quartet-grid")
        [inputs[2], inputs[3]] = [inputs[3], inputs[2]];
      const { phones } = createScene(inputs, { preset });
      const bounds = phones.map(chassisBounds);
      const columns = preset === "quartet-grid" ? 2 : count;
      const gap = bounds[1].left - bounds[0].right;
      expect(gap).toBeGreaterThan(0);
      if (preset === "quartet-grid") {
        expect(bounds[0].right).toBeCloseTo(bounds[2].right, 10);
        expect(bounds[1].left).toBeCloseTo(bounds[3].left, 10);
      }
      for (let i = 0; i < count; i++) {
        expect(bounds[i].bottom - bounds[i].top).toBeCloseTo(
          bounds[0].bottom - bounds[0].top,
          10,
        );
        if (i % columns) {
          expect(bounds[i].bottom).toBeCloseTo(bounds[i - 1].bottom, 10);
          expect(bounds[i].left - bounds[i - 1].right).toBeCloseTo(gap, 10);
        }
        if (i >= columns)
          expect(bounds[i].top - bounds[i - columns].bottom).toBeCloseTo(
            gap,
            10,
          );
      }
    }
});

test("explicit poses keep their origins and user scale ratios after normalization", () => {
  for (const reversed of [false, true]) {
    const poses = [
      { x: 123, y: -45, scale: 0.8, z: 1 },
      { x: -210, y: 67, scale: 1.2, z: -1 },
    ];
    const phones = createScene(mixedCaptures(2, reversed), {
      preset: "duo-front",
      poses,
    }).phones.toSorted((a, b) => a.index - b.index);
    phones.forEach((phone, i) => {
      expect(phone.project(0, 0)).toEqual({ x: poses[i].x, y: poses[i].y });
    });
    expect(
      ((phones[0].height + 2 * phones[0].bezel) * phones[0].scale) /
        ((phones[1].height + 2 * phones[1].bezel) * phones[1].scale),
    ).toBeCloseTo(0.8 / 1.2, 12);
  }
});

test("authored overlap, fan and depth centres stay fixed across native capture order", () => {
  for (const preset of [
    "duo-overlap",
    "triple-fan",
    "duo-depth",
    "quartet-depth",
  ]) {
    const spec = SCENE_PRESETS[preset];
    const scenes = [false, true].map((reversed) =>
      createScene(mixedCaptures(spec.poses.length, reversed), { preset }),
    );
    scenes[0].phones.forEach((phone, i) => {
      const other = scenes[1].phones[i];
      const centre = phone.project(phone.width / 2, phone.height / 2);
      const otherCentre = other.project(other.width / 2, other.height / 2);
      expect(centre.x).toBeCloseTo(otherCentre.x, 12);
      expect(centre.y).toBeCloseTo(otherCentre.y, 12);
      expect(phone.z).toBe(spec.poses[phone.index].z);
      expect(phone.rotateZ).toBe(spec.poses[phone.index].rotateZ);
      expect(
        ((phone.height + 2 * phone.bezel) * phone.scale) /
          spec.poses[phone.index].scale,
      ).toBeCloseTo(
        ((other.height + 2 * other.bezel) * other.scale) /
          spec.poses[other.index].scale,
        10,
      );
    });
  }
});

test("named presets, custom 1-N lists, depth order, and bounds use one scene model", () => {
  for (const [preset, spec] of Object.entries(SCENE_PRESETS)) {
    const scene = createScene(mixedCaptures(spec.poses.length), {
      preset,
    });
    expect(scene.phones).toHaveLength(spec.poses.length);
    expect(scene.phones.map((p) => p.z)).toEqual(
      scene.phones.map((p) => p.z).toSorted((a, b) => a - b),
    );
    for (const p of scene.phones)
      for (const point of p.corners) {
        expect(point.x).toBeGreaterThan(scene.x);
        expect(point.x).toBeLessThan(scene.x + scene.width);
        expect(point.y).toBeGreaterThan(scene.y);
        expect(point.y).toBeLessThan(scene.y + scene.height);
      }
    expect(() =>
      createScene(mixedCaptures(spec.poses.length + 1), { preset }),
    ).toThrow();
  }
  for (const n of [1, 4, 7, 20])
    expect(createScene(mixedCaptures(n)).phones).toHaveLength(n);
  expect(
    createScene([capture], { poses: [{ rotateZ: 90 }] }).phones[0].screenHeight,
  ).toBe(956);
});

test("bounds contain every rendered depth section, including the intermediate side bulge", () => {
  for (const input of [proCapture, capture])
    for (const rotateY of [-75, 0, 75])
      for (const rotateX of [-75, 0, 75]) {
        const scene = createScene([input], {
          poses: [
            { x: -123, y: 45, rotateX, rotateY, rotateZ: 32, scale: 1.2 },
          ],
        });
        const phone = scene.phones[0];
        const svg = renderPhone(phone, { id: "bounds", href: "/capture.png" });
        const offsets = [
          ...svg.matchAll(
            /<use class="phone-shell"[^>]*stroke-width="([^"]+)"/g,
          ),
        ].map((match) => Number(match[1]) / 2);
        expect(offsets).toHaveLength(65);
        expect(offsets[32]).toBeCloseTo(phone.bezel, 12);
        expect(offsets[32]).toBeGreaterThan(offsets[0]);
        expect(offsets[32]).toBeGreaterThan(offsets[64]);
        const minX = Math.min(...phone.corners.map((p) => p.x));
        const maxX = Math.max(...phone.corners.map((p) => p.x));
        const minY = Math.min(...phone.corners.map((p) => p.y));
        const maxY = Math.max(...phone.corners.map((p) => p.y));
        offsets.forEach((offset, i) => {
          const depth = -phone.thickness + (phone.thickness * i) / 64;
          // The offset contour lies within this rectangle, before projection.
          for (const x of [-offset, phone.width + offset])
            for (const y of [-offset, phone.height + offset]) {
              const point = phone.project(x, y, depth);
              expect(point.x).toBeGreaterThanOrEqual(minX);
              expect(point.x).toBeLessThanOrEqual(maxX);
              expect(point.y).toBeGreaterThanOrEqual(minY);
              expect(point.y).toBeLessThanOrEqual(maxY);
            }
        });
      }
});

test("scene boundary rejects unknown platforms, presets, corrupt poses, and hidden platform overrides", () => {
  for (const key of ["web/wallet", "ios/../android/wallet", "wallet"])
    expect(() => createScene([{ ...capture, key }])).toThrow();
  for (const preset of ["unknown", "toString", "__proto__"])
    expect(() => createScene([capture], { preset })).toThrow();
  for (const poses of [
    [],
    [null],
    [{ x: NaN }],
    [{ scale: 0 }],
    [{ scale: null }],
    [{ x: null }],
    [{ scale: "1" }],
    [{ rotateY: 90 }],
    [{ platform: "android" }],
  ])
    expect(() => createScene([capture], { poses })).toThrow();
  expect(() => createScene([])).toThrow();
});

test('mixed iOS/Android scenes retain native ratios and enforce explicit frame identity', () => {
  const inputs = [capture, { key: 'android/wallet', width: 1080, height: 2400, frameId: 'android-emulator' }];
  for (const ordered of [inputs, [...inputs].reverse()]) {
    const scene = createScene(ordered, { preset: 'duo-front' });
    scene.phones.forEach((phone, index) => {
      expect(phone.width / phone.height).toBeCloseTo(ordered[index].width / ordered[index].height, 12);
      expect(phone.platform).toBe(ordered[index].key.split('/')[0]);
    });
    expect((scene.phones[0].height + scene.phones[0].bezel * 2) * scene.phones[0].scale).toBeCloseTo((scene.phones[1].height + scene.phones[1].bezel * 2) * scene.phones[1].scale, 10);
  }
  expect(() => createScene([{ ...capture, frameId: 'android-emulator' }])).toThrow();
  expect(() => createScene([{ ...capture, frameId: 'iphone-17-pro' }])).toThrow();
  expect(createScene([{ ...capture, frameId: 'iphone-17-pro-max' }]).phones[0].id).toBe('iphone-17-pro-max');
});

test("website integrates shared geometry, literal selected assets and a visible currentness disclosure", () => {
  const component = readFileSync(
    new URL("../src/components/PhoneScene.astro", import.meta.url),
    "utf8",
  );
  const integration = readFileSync(
    new URL("../src/lib/phoneGeometry.ts", import.meta.url),
    "utf8",
  );
  expect(component).toContain("scripts/lib/phone-frame.mjs");
  expect(component).toContain("figcaption");
  expect(component).toContain("data-capture-currentness");
  expect(integration).not.toContain("import.meta.glob");
  expect(integration).toContain("press/website.json");
  expect(integration).not.toContain("function continuousPath");
  const script = readFileSync(
    new URL("../scripts/visual.mjs", import.meta.url),
    "utf8",
  );
  expect(script).not.toMatch(/\/Users\/|\/var\/folders\//);
  expect(script).toContain("CHROME_PATH");
  expect(script).toContain("Chrome command timed out");
  expect(script).toContain("rm(scratch");
  expect(script).not.toMatch(/rm\(output/);
});
