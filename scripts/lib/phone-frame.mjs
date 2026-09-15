// Equal-radius construction from react-native-fast-squircle 1.1.5,
// ios/SquirclePathGenerator.swift (MIT, site/public/licenses/fast-squircle.txt).
// Smoothing .6 matches the app's SquircleView. See press/mockups/README.md
// for capture identity evidence and the limits of this illustrative model.
export function continuousPath(width, height, radius) {
  if (
    ![width, height, radius].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    radius < 0
  )
    throw new Error("Invalid phone contour");
  if (radius === 0) return `M 0 0 H ${width} V ${height} H 0 Z`;
  const r = Math.min(radius, width / 2, height / 2);
  const smoothing = Math.min(0.6, Math.min(width, height) / (2 * r) - 1);
  const p = (1 + smoothing) * r;
  const rad = Math.PI / 180;
  const arc = Math.sin(45 * (1 - smoothing) * rad) * r * Math.SQRT2;
  const c =
    r * Math.tan(22.5 * smoothing * rad) * Math.cos(45 * smoothing * rad);
  const d = c * Math.tan(45 * smoothing * rad);
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  return `M ${width - p} 0
    c ${a} 0 ${a + b} 0 ${a + b + c} ${d}
    a ${r} ${r} 0 0 1 ${arc} ${arc}
    c ${d} ${c} ${d} ${b + c} ${d} ${a + b + c}
    L ${width} ${height - p}
    c 0 ${a} 0 ${a + b} ${-d} ${a + b + c}
    a ${r} ${r} 0 0 1 ${-arc} ${arc}
    c ${-c} ${d} ${-b - c} ${d} ${-a - b - c} ${d}
    L ${p} ${height}
    c ${-a} 0 ${-a - b} 0 ${-a - b - c} ${-d}
    a ${r} ${r} 0 0 1 ${-arc} ${-arc}
    c ${-d} ${-c} ${-d} ${-b - c} ${-d} ${-a - b - c}
    L 0 ${p}
    c 0 ${-a} 0 ${-a - b} ${d} ${-a - b - c}
    a ${r} ${r} 0 0 1 ${arc} ${-arc}
    c ${c} ${-d} ${b + c} ${-d} ${a + b + c} ${-d} Z`;
}

export function captureDevice(platform, width, height) {
  if (
    ![width, height].every((v) => Number.isFinite(v) && v > 0) ||
    height <= width
  )
    throw new Error(
      "A full portrait capture is required; do not rotate app pixels into landscape",
    );
  if (platform === "android")
    return {
      id: "android-emulator",
      width: 360,
      height: (360 * height) / width,
      radius: 0,
      bezel: 9,
      thickness: 18,
    };
  if (platform !== "ios") throw new Error("Unknown capture platform");
  // Apple's 460ppi at @3x. Average the two rounded published dimensions so
  // the continuous normal offset stays uniform (within .1mm of both axes).
  const pointsPerMm = 460 / 25.4 / 3;
  const devices = [
    {
      id: "iphone-17-pro",
      width: 402,
      height: 874,
      radius: 62,
      bezel: ((71.9 + 150) * pointsPerMm - 402 - 874) / 4,
      thickness: 8.75 * pointsPerMm,
    },
    {
      id: "iphone-17-pro-max",
      width: 440,
      height: 956,
      radius: 62,
      bezel: ((78 + 163.4) * pointsPerMm - 440 - 956) / 4,
      thickness: 8.75 * pointsPerMm,
    },
  ];
  const device = devices.find(
    (d) => Math.abs(width / height - d.width / d.height) < 0.000001,
  );
  if (!device)
    throw new Error(`Unreviewed iOS capture dimensions: ${width}x${height}`);
  return device;
}

// Orthographic Rz * Ry * Rx camera. Screen pixels and the entire extrusion use
// the SAME matrix, about the screen centre. z is camera depth (paint order),
// not an invented perspective scale. Roll rotates the whole portrait device.
export function phoneGeometry(
  imageWidth,
  imageHeight,
  {
    platform = "ios",
    x = 0,
    y = 0,
    z = 0,
    rotateX = 0,
    rotateY = 0,
    rotateZ = 0,
    scale = 1,
  } = {},
) {
  if (
    ![x, y, z, rotateX, rotateY, rotateZ, scale].every(Number.isFinite) ||
    scale <= 0 ||
    Math.abs(rotateX) > 75 ||
    Math.abs(rotateY) > 75
  )
    throw new Error(
      "Invalid pose: positive scale and front-facing pitch/yaw within +/-75 degrees required",
    );
  const device = captureDevice(platform, imageWidth, imageHeight);
  const { width, height, radius, bezel, thickness } = device;
  const rx = (rotateX * Math.PI) / 180,
    ry = (rotateY * Math.PI) / 180,
    rz = (rotateZ * Math.PI) / 180;
  const a = Math.cos(ry) * Math.cos(rz),
    b = Math.cos(ry) * Math.sin(rz);
  const c =
    Math.sin(rx) * Math.sin(ry) * Math.cos(rz) - Math.cos(rx) * Math.sin(rz);
  const d =
    Math.sin(rx) * Math.sin(ry) * Math.sin(rz) + Math.cos(rx) * Math.cos(rz);
  const zx =
    Math.cos(rx) * Math.sin(ry) * Math.cos(rz) + Math.sin(rx) * Math.sin(rz);
  const zy =
    Math.cos(rx) * Math.sin(ry) * Math.sin(rz) - Math.sin(rx) * Math.cos(rz);
  const project = (px, py, pz = 0) => ({
    x:
      x +
      scale *
        (width / 2 + a * (px - width / 2) + c * (py - height / 2) + zx * pz),
    y:
      y +
      scale *
        (height / 2 + b * (px - width / 2) + d * (py - height / 2) + zy * pz),
  });
  const matrix = (pz) => {
    const origin = project(0, 0, pz);
    return `matrix(${a * scale} ${b * scale} ${c * scale} ${d * scale} ${origin.x} ${origin.y})`;
  };
  const protrusion = bezel + 2.5;
  const corners = [0, -thickness].flatMap((pz) =>
    [
      [-protrusion, -bezel - 1],
      [width + protrusion, -bezel - 1],
      [width + protrusion, height + bezel + 1],
      [-protrusion, height + bezel + 1],
    ].map(([px, py]) => project(px, py, pz)),
  );
  return {
    ...device,
    imageWidth,
    imageHeight,
    platform,
    z,
    scale,
    rotateX,
    rotateY,
    rotateZ,
    project,
    matrix,
    corners,
    screenWidth: width,
    screenHeight: height,
    screen: continuousPath(width, height, radius),
  };
}

function sceneBounds(phones, padding = 28) {
  if (!phones.length || !Number.isFinite(padding) || padding < 0)
    throw new Error("Invalid scene bounds");
  const points = phones.flatMap((p) => p.corners);
  const x = Math.min(...points.map((p) => p.x)) - padding;
  const y = Math.min(...points.map((p) => p.y)) - padding;
  const width = Math.max(...points.map((p) => p.x)) - x + padding;
  const height = Math.max(...points.map((p) => p.y)) - y + padding;
  return { x, y, width, height, viewBox: `${x} ${y} ${width} ${height}` };
}

const pose = (
  x,
  y,
  rotateZ = 0,
  rotateY = 0,
  rotateX = 0,
  z = 0,
  scale = 1,
) => ({ x, y, rotateZ, rotateY, rotateX, z, scale });
// Output canvases are pixels, not camera transforms. Fit the projected scene
// with xMidYMid meet so the screen and chassis retain one uniform scale.
export const CANVAS_FORMATS = {
  native: null,
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1920, height: 1080 },
  landscape: { width: 1200, height: 630 },
};

// Familiar product-photography compositions, not replicas of manufacturer
// photography. Opposing poses use equal angles; reading layouts use measured gaps.
export const SCENE_PRESETS = {
  "single-front": { name: "Single / front", poses: [pose(0, 0)] },
  "single-left": {
    name: "Single / left three-quarter",
    poses: [pose(0, 0, 0, -30)],
  },
  "single-right": {
    name: "Single / right three-quarter",
    poses: [pose(0, 0, 0, 30)],
  },
  "single-top": { name: "Single / elevated", poses: [pose(0, 0, 0, 0, 25)] },
  "single-bottom": {
    name: "Single / low angle",
    poses: [pose(0, 0, 0, 0, -25)],
  },
  "single-diagonal-left": {
    name: "Single / diagonal left",
    poses: [pose(0, 0, -30, -20, 12)],
  },
  "single-diagonal-right": {
    name: "Single / diagonal right",
    poses: [pose(0, 0, 30, 20, 12)],
  },
  "single-flatlay": { name: "Single / flat lay", poses: [pose(0, 0, -90)] },
  "single-tilt": { name: "Single / tilt", poses: [pose(0, 0, 10, -20, 8)] },
  "duo-front": {
    name: "Duo / front comparison",
    layout: "row",
    poses: [pose(0, 0), pose(480, 0)],
  },
  "duo-mirror": {
    name: "Duo / mirrored three-quarter",
    poses: [pose(0, 0, -6, -24, 10), pose(500, 0, 6, 24, 10)],
  },
  "duo-diagonal": {
    name: "Duo / parallel diagonal",
    poses: [pose(0, 0, -30), pose(500, 280, -30)],
  },
  "duo-overlap": {
    name: "Duo / overlap",
    poses: [pose(0, 0, -8, -14, 6, -1), pose(225, 120, 8, -14, 6)],
  },
  "duo-depth": {
    name: "Duo / depth",
    poses: [pose(0, 0, 12, -24, 10, -1, 0.9), pose(235, 205, 12, -24, 10)],
  },
  "triple-fan": {
    name: "Triple / fan",
    poses: [
      pose(0, 70, -16, -15, 5, -2),
      pose(450, 70, 16, 15, 5, -1),
      pose(225, 0),
    ],
  },
  "triple-row": {
    name: "Triple / row",
    layout: "row",
    poses: [pose(0, 0), pose(480, 0), pose(960, 0)],
  },
  "triple-steps": {
    name: "Triple / ascending steps",
    poses: [pose(0, 240, 0, -12), pose(440, 120, 0, -12), pose(880, 0, 0, -12)],
  },
  "quartet-grid": {
    name: "Quartet / two by two",
    layout: "grid",
    poses: [pose(0, 0), pose(480, 0), pose(0, 1030), pose(480, 1030)],
  },
  "quartet-side-by-side": {
    name: "Quartet / side by side",
    layout: "row",
    poses: [pose(0, 0), pose(480, 0), pose(960, 0), pose(1440, 0)],
  },
  "quartet-stagger": {
    name: "Quartet / stagger",
    poses: [
      pose(0, 0, -4),
      pose(455, 110, -4),
      pose(910, 0, -4),
      pose(1365, 110, -4),
    ],
  },
  "quartet-depth": {
    name: "Quartet / depth",
    poses: [
      pose(0, 0, 10, -28, 12, -3, 0.82),
      pose(300, 95, 10, -28, 12, -2, 0.88),
      pose(620, 195, 10, -28, 12, -1, 0.94),
      pose(960, 300, 10, -28, 12),
    ],
  },
};

export function createScene(captures, { preset = "custom", poses } = {}) {
  if (!Array.isArray(captures) || !captures.length)
    throw new Error("Choose at least one screenshot");
  const definition = Object.hasOwn(SCENE_PRESETS, preset)
    ? SCENE_PRESETS[preset]
    : undefined;
  if (preset !== "custom" && !definition)
    throw new Error(`Unknown scene preset: ${preset}`);
  if (definition && captures.length !== definition.poses.length)
    throw new Error(
      `${preset} requires ${definition.poses.length} screenshots`,
    );
  if (poses && (!Array.isArray(poses) || poses.length !== captures.length))
    throw new Error("Supply one pose per screenshot");
  // Presentation is anchored to one fixed chassis, never to the first capture.
  // Native calibration and the artwork caller's requested-width scale stay intact.
  const reference = captureDevice("ios", 1206, 2622);
  const chassisHeight = reference.height + 2 * reference.bezel;
  const layout = poses
    ? undefined
    : (definition?.layout ?? (preset === "custom" ? "row" : undefined));
  const gap = 48;
  let rowX = 0;
  const phones = captures
    .map((capture, index) => {
      if (!/^ios\/[a-z0-9-]+$/.test(capture.key))
        throw new Error(
          "Website scenes accept only reviewed ios/ screenshot references",
        );
      const placement = poses
        ? poses[index]
        : (definition?.poses[index] ?? pose(0, 0));
      if (
        !placement ||
        typeof placement !== "object" ||
        Object.values(placement).some(
          (value) => value !== undefined && !Number.isFinite(value),
        ) ||
        Object.keys(placement).some(
          (key) =>
            !["x", "y", "z", "rotateX", "rotateY", "rotateZ", "scale"].includes(
              key,
            ),
        )
      )
        throw new Error("Invalid pose fields");
      const device = captureDevice("ios", capture.width, capture.height);
      const scale =
        ((placement.scale ?? 1) * chassisHeight) /
        (device.height + 2 * device.bezel);
      let x = placement.x ?? 0;
      let y = placement.y ?? 0;
      if (layout) {
        const frameWidth = (device.width + 2 * device.bezel) * scale;
        // The grid shares a central gutter; mixed-width rows need not share a stride.
        x =
          (layout === "grid"
            ? index % 2
              ? gap / 2
              : -gap / 2 - frameWidth
            : rowX) +
          device.bezel * scale;
        y =
          (layout === "grid"
            ? Math.floor(index / 2) * (chassisHeight + gap)
            : 0) +
          device.bezel * scale;
        rowX += frameWidth + gap;
      } else if (!poses) {
        // Keep authored composition centres stable, including intentionally smaller depth layers.
        x += (reference.width - device.width * scale) / 2;
        y += (reference.height - device.height * scale) / 2;
      }
      return {
        ...capture,
        ...phoneGeometry(capture.width, capture.height, {
          ...placement,
          x,
          y,
          scale,
          platform: "ios",
        }),
        index,
      };
    })
    .sort((a, b) => a.z - b.z || a.index - b.index);
  return { phones, ...sceneBounds(phones) };
}

const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

// All contours are the display curve with a parallel outward stroke. Unlike
// independently increasing a squircle's radius, this is a uniform normal offset
// at EVERY point, including the cubic-to-arc transitions. Never stroke over UI.
export function renderPhone(
  phone,
  { id, href, alt = "Sovran app capture", underlay = "" },
) {
  if (!/^[a-zA-Z][\w-]*$/.test(id)) throw new Error("Invalid frame ID");
  if (!/^(data:image\/|\/[^/])/.test(href))
    throw new Error("Use an embedded or local screenshot URL");
  const { screen, width, height, bezel, thickness, matrix, platform } = phone;
  const surface = (offset, fill, transform = "", className = "") =>
    `<use class="${className}" href="#${id}-contour" transform="${transform}" fill="${fill}" stroke="${fill}" stroke-width="${offset * 2}" stroke-linejoin="round"/>`;
  const layers = Array.from({ length: 65 }, (_, i) => {
    const z = -thickness + (thickness * i) / 64;
    // Round inward: the intermediate side bulge never exceeds the calibrated chassis.
    const rounding = 0.8 * (Math.sin((Math.PI * i) / 64) - 1);
    return surface(
      bezel + rounding,
      `url(#${id}-metal)`,
      matrix(z),
      "phone-shell",
    );
  }).join("");
  const buttons =
    platform === "ios"
      ? [
          [-bezel - 1.5, height * 0.16, 18],
          [-bezel - 1.5, height * 0.23, 42],
          [-bezel - 1.5, height * 0.3, 42],
          [width + bezel + 1.5, height * 0.25, 65],
          [width + bezel + 1.5, height * 0.72, 42],
        ]
      : [
          [width + bezel + 1, height * 0.22, 38],
          [width + bezel + 1, height * 0.32, 65],
        ];
  const hardware = buttons
    .map(([x, y, h]) => {
      const corners = [
        [x, y, -thickness * 0.7],
        [x, y + h, -thickness * 0.7],
        [x, y + h, -thickness * 0.3],
        [x, y, -thickness * 0.3],
      ].map((p) => phone.project(...p));
      return `<path d="M ${corners.map((p) => `${p.x} ${p.y}`).join(" L ")} Z" fill="#303230" stroke="#555852" stroke-width="${0.45 * phone.scale}" stroke-linejoin="round"/>`;
    })
    .join("");
  return `<g class="phone-model" data-device="${phone.id}" data-platform="${platform}" data-phone="${phone.index ?? 0}" role="img" aria-label="${escape(alt)}">
    <defs>
      <path id="${id}-contour" d="${screen}"/>
      <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2=".65"><stop stop-color="#383b37"/><stop offset=".5" stop-color="#252724"/><stop offset="1" stop-color="#40433e"/></linearGradient>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#74786f"/><stop offset=".5" stop-color="#444840"/><stop offset="1" stop-color="#696e63"/></linearGradient>
      <clipPath id="${id}-screen" clipPathUnits="userSpaceOnUse"><path d="${screen}"/></clipPath>
    </defs>
    ${layers}${hardware}
    <g class="phone-front" transform="${matrix(0)}">
      ${surface(bezel, `url(#${id}-rim)`)}
      ${surface(bezel - 1, "#050606")}
      ${underlay}
      <image class="phone-screen" width="${width}" height="${height}" href="${escape(href)}" preserveAspectRatio="none" clip-path="url(#${id}-screen)" data-source-width="${phone.imageWidth ?? width}" data-source-height="${phone.imageHeight ?? height}" data-radius="${phone.radius}"/>
    </g>
  </g>`;
}
