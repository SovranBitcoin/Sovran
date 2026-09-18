// Equal-radius construction from react-native-fast-squircle 1.1.5,
// ios/SquirclePathGenerator.swift (MIT, site/public/licenses/fast-squircle.txt).
// Smoothing .6 matches the app's SquircleView. See site/README.md
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

// The border between the display and the outside of the body is calibrated from
// published dimensions, but how that border DIVIDES between the display's black
// mask and the frame's bright chamfer is not published, so this share is an
// illustrative choice. It is load-bearing all the same: a dark capture against
// an all-black bezel has no visible edge, so the eye reads the bezel as part of
// the screenshot and the app looks wider than it is. The chamfer and the glass
// edge below are what keep the capture's own boundary legible.
export const FRAME_RAIL_SHARE = 0.3;

export const FRAME_IDS = Object.freeze({
  ios: ['iphone-17-pro', 'iphone-17-pro-max'],
  android: ['android-emulator'],
});

/**
 * The library-v1 body for each platform, in device units. Draft placeholders
 * use it so a missing capture is framed as the phone it is waiting for, and
 * never as another platform's chassis.
 */
export const LIBRARY_BODY = Object.freeze({
  ios: Object.freeze({ width: 440, height: 956 }),
  android: Object.freeze({ width: 360, height: 800 }),
});

export function captureDevice(platform, width, height, frameId) {
  if (frameId !== undefined && !FRAME_IDS[platform]?.includes(frameId))
    throw new Error('Frame does not belong to the capture platform');
  if (
    ![width, height].every((v) => Number.isFinite(v) && v > 0) ||
    height <= width
  )
    throw new Error(
      "A full portrait capture is required; do not rotate app pixels into landscape",
    );
  if (platform === "android") {
    // Only the pinned library-v1 emulator (1080x2400) is a reviewed framing
    // geometry. Store-delivery captures are 1080x1920 because Play rejects
    // ratios above 2:1; deriving a body from whatever ratio arrived silently
    // drew two different phones side by side. Recapture instead.
    const device = {
      id: "android-emulator",
      width: 360,
      height: 800,
      radius: 0,
      bezel: 9,
      thickness: 18,
    };
    if (Math.abs(width / height - device.width / device.height) > 0.000001)
      throw new Error(`Unreviewed Android capture dimensions: ${width}x${height}`);
    return device;
  }
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
  if (frameId && device.id !== frameId)
    throw new Error('Frame aspect ratio does not match the native capture');
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
    frameId,
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
  const device = captureDevice(platform, imageWidth, imageHeight, frameId);
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
  // The rotation's third row, recovered as row1 x row2. A rotation is
  // orthonormal with determinant +1, so this is the exact camera-depth row of
  // the SAME matrix the screen and extrusion already use - not a second,
  // independently authored depth model. Depth is 0 at the screen centre and
  // positive toward the camera, matching the extrusion's negative thickness.
  const depthX = c * zy - zx * d;
  const depthY = zx * b - a * zy;
  const depthZ = a * d - c * b;
  const world = (px, py, pz = 0) => {
    const point = project(px, py, pz);
    return {
      ...point,
      z:
        scale *
        (depthX * (px - width / 2) + depthY * (py - height / 2) + depthZ * pz),
    };
  };
  const protrusion = bezel + 2.5;
  const chassis = [0, -thickness].flatMap((pz) =>
    [
      [-protrusion, -bezel - 1],
      [width + protrusion, -bezel - 1],
      [width + protrusion, height + bezel + 1],
      [-protrusion, height + bezel + 1],
    ].map(([px, py]) => [px, py, pz]),
  );
  const corners = chassis.map((point) => project(...point));
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
    world,
    matrix,
    chassis,
    corners,
    worldCorners: chassis.map((point) => world(...point)),
    screenWidth: width,
    screenHeight: height,
    screen: continuousPath(width, height, radius),
  };
}

// How far a shadow may push the frame out beyond the devices themselves.
export const SHADOW_FRAME_LIMIT = 1.3;

function sceneBounds(phones, padding = 28, extra = []) {
  if (!phones.length || !Number.isFinite(padding) || padding < 0)
    throw new Error("Invalid scene bounds");
  const points = phones.flatMap((p) => p.corners);
  // The devices are the subject. A shadow may enlarge the frame, but it must
  // never slide the phones off its centre, so the frame grows by the same
  // amount either side of the device centre rather than trailing the light.
  // Growth is capped: past this the phones would be shrinking to make room for
  // their own shadow, and a soft tail is the right thing to lose at the edge.
  const span = (axis) => {
    const min = Math.min(...points.map((p) => p[axis])) - padding;
    const max = Math.max(...points.map((p) => p[axis])) + padding;
    const centre = (min + max) / 2;
    const devices = max - centre;
    const reach = Math.min(
      Math.max(devices, ...extra.map((p) => Math.abs(p[axis] - centre) + padding)),
      devices * SHADOW_FRAME_LIMIT,
    );
    return { min: centre - reach, size: 2 * reach };
  };
  const x = span("x"),
    y = span("y");
  return {
    x: x.min,
    y: y.min,
    width: x.size,
    height: y.size,
    viewBox: `${x.min} ${y.min} ${x.size} ${y.size}`,
  };
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

/**
 * A rotated lattice. Every phone carries the same roll, and the centres sit on
 * a grid whose basis vectors carry that same rotation, so rows and columns stay
 * parallel to the phone edges at any angle - the repeating contact-sheet
 * mosaic, rather than per-phone nudges that only look aligned. `stagger` shifts
 * alternating columns by a fraction of the vertical stride for a brick lattice.
 * Strides are lattice pitch, so a stride above the chassis footprint
 * (471 x 987 reference units) is a gap and anything below it is an overlap.
 * The lattice is centred on its own centroid, so the composition does not drift
 * as columns or rows are added.
 */
const mosaic = (
  angle,
  columns,
  rows,
  strideX,
  strideY,
  { stagger = 0, rotateY = 0, rotateX = 0, scale = 1 } = {},
) => {
  if (
    ![columns, rows].every((n) => Number.isInteger(n) && n > 0) ||
    ![angle, strideX, strideY, stagger].every(Number.isFinite)
  )
    throw new Error("Invalid mosaic lattice");
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const cells = Array.from({ length: columns * rows }, (_, i) => ({
    x: (i % columns) * strideX,
    y: (Math.floor(i / columns) + ((i % columns) % 2 ? stagger : 0)) * strideY,
  }));
  const centre = {
    x: cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length,
  };
  return cells.map(({ x, y }) => {
    const lx = x - centre.x,
      ly = y - centre.y;
    return pose(
      cos * lx - sin * ly,
      sin * lx + cos * ly,
      angle,
      rotateY,
      rotateX,
      0,
      scale,
    );
  });
};
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
  "single-hero": { name: "Single / hero lean", poses: [pose(0, 0, -2, -16, 6)] },
  "single-float": { name: "Single / floating", poses: [pose(0, 0, 0, -9, 5)] },
  "single-flatlay-angled": {
    name: "Single / angled flat lay",
    poses: [pose(0, 0, -30)],
  },
  "single-isometric-left": {
    name: "Single / isometric left",
    poses: [pose(0, 0, -26, -30, 16)],
  },
  "single-isometric-right": {
    name: "Single / isometric right",
    poses: [pose(0, 0, 26, 30, 16)],
  },
  "single-edge-left": {
    name: "Single / left edge",
    poses: [pose(0, 0, 0, -52)],
  },
  "single-edge-right": {
    name: "Single / right edge",
    poses: [pose(0, 0, 0, 52)],
  },
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
  "duo-scissor": {
    name: "Duo / opposed roll",
    poses: [pose(0, 0, -12), pose(500, 0, 12)],
  },
  "duo-parallel": {
    name: "Duo / parallel three-quarter",
    poses: [pose(0, 0, 0, -22, 8), pose(500, 0, 0, -22, 8)],
  },
  "duo-stagger": {
    name: "Duo / staggered pair",
    poses: [pose(0, -150, -4, -12, 6), pose(505, 150, -4, -12, 6)],
  },
  "duo-stack": {
    name: "Duo / stacked column",
    poses: [pose(0, -545), pose(0, 545)],
  },
  "duo-mosaic": { name: "Duo / rotated mosaic", poses: mosaic(-30, 2, 1, 520, 0) },
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
  "triple-arc": {
    name: "Triple / symmetric arc",
    poses: [
      pose(-490, 170, -14, -16, 6, -1),
      pose(0, 0, 0, 0, 6),
      pose(490, 170, 14, 16, 6, -1),
    ],
  },
  "triple-overlap": {
    name: "Triple / overlapping deck",
    poses: [
      pose(0, 0, -6, -16, 8, -2, 0.92),
      pose(285, 130, -6, -16, 8, -1, 0.96),
      pose(570, 260, -6, -16, 8),
    ],
  },
  "triple-column": {
    name: "Triple / stacked column",
    poses: [pose(0, -1060), pose(0, 0), pose(0, 1060)],
  },
  "triple-diagonal": {
    name: "Triple / rotated diagonal",
    poses: mosaic(-28, 3, 1, 520, 0),
  },
  "triple-mosaic-stagger": {
    name: "Triple / staggered mosaic",
    poses: mosaic(-30, 3, 1, 520, 1055, { stagger: 0.42 }),
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
  "quartet-fan": {
    name: "Quartet / symmetric fan",
    poses: [
      pose(-820, 190, -19, -19, 8, -2),
      pose(-275, 0, -7, -7, 8, -1),
      pose(275, 0, 7, 7, 8, -1),
      pose(820, 190, 19, 19, 8, -2),
    ],
  },
  "quartet-mosaic": {
    name: "Quartet / rotated mosaic",
    poses: mosaic(-30, 2, 2, 520, 1055),
  },
  "quartet-mosaic-stagger": {
    name: "Quartet / staggered mosaic",
    poses: mosaic(-30, 2, 2, 520, 1055, { stagger: 0.5 }),
  },
  "quartet-flatlay-row": {
    name: "Quartet / angled flat-lay row",
    poses: mosaic(-18, 4, 1, 520, 0),
  },
};

// A ground the phones actually stand on, not a drop shadow. The camera is
// orthographic, the ground is a flat plane and the key light is directional, so
// the shadow of any device point is an EXACT affine image of that point: one
// SVG matrix over the same contour the chassis is built from. Nothing here
// offsets, scales or blurs a copy of the drawn phone.
export const SHADOW_GROUNDS = Object.freeze({
  // `pitch` is the plane's tilt away from the image plane. 0 is the table of a
  // top-down flat lay; a large angle is a floor receding under standing phones.
  table: Object.freeze({ name: "Table / flat lay", pitch: 0 }),
  floor: Object.freeze({ name: "Floor / standing", pitch: 62 }),
});
export const DEFAULT_SHADOW = Object.freeze({
  ground: "table",
  height: 0,
  softness: 0.6,
  opacity: 0.38,
  angle: 62,
  tilt: 26,
  samples: 14,
});
export const SHADOW_LIMITS = Object.freeze({
  height: [0, 1.5],
  softness: [0, 1],
  opacity: [0, 0.9],
  angle: [-180, 180],
  tilt: [0, 70],
  samples: [1, 24],
});

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const step = (a, b, k) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const normalize = (v) => {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!(length > 1e-9)) throw new Error("Degenerate direction");
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};

/**
 * Resolve the scene's ground plane and key light. The plane is placed against
 * the scene's own lowest point, so `height` 0 means resting on it and a
 * positive height (in chassis heights) means hovering a measured distance above
 * it - never intersecting it, whatever the poses are.
 */
function groundPlane(phones, settings = {}, chassisHeight = 1) {
  const value = { ...DEFAULT_SHADOW, ...settings };
  const spec = SHADOW_GROUNDS[value.ground];
  if (!spec) throw new Error(`Unknown ground: ${value.ground}`);
  for (const [key, [min, max]] of Object.entries(SHADOW_LIMITS))
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max)
      throw new Error(`Shadow ${key} is outside ${min}-${max}`);
  const pitch = (spec.pitch * Math.PI) / 180;
  // The plane's normal points back toward the phones and the camera.
  const normal = { x: 0, y: -Math.sin(pitch), z: Math.cos(pitch) };
  // An in-plane basis: u runs along the plane's horizon, v recedes into it.
  const u = { x: 1, y: 0, z: 0 };
  const v = cross(normal, u);
  const azimuth = (value.angle * Math.PI) / 180;
  const tilt = (value.tilt * Math.PI) / 180;
  // Direction of travel: at tilt 0 the light runs straight down the normal and
  // the shadow sits directly under the phone.
  const light = normalize(
    step(step(step({ x: 0, y: 0, z: 0 }, u, Math.sin(tilt) * Math.cos(azimuth)), v, Math.sin(tilt) * Math.sin(azimuth)), normal, -Math.cos(tilt)),
  );
  const offset =
    Math.min(...phones.flatMap((phone) => phone.worldCorners.map((point) => dot(normal, point)))) -
    value.height * chassisHeight;
  return {
    ...value,
    normal,
    light,
    offset,
    // Angular radius of the disc source. A point one unit from the plane casts
    // a penumbra this wide, which is why contact stays sharp and height softens.
    radius: 2 + value.softness * 20,
    samples: lightSamples(light, 2 + value.softness * 20, Math.round(value.samples)),
  };
}

/**
 * Equal-area (Vogel) samples of the light's cone. Stacking their shadows is the
 * penumbra of a disc source, so softness follows the distance to the plane
 * instead of being a uniform blur applied after the fact.
 */
function lightSamples(light, angularRadius, count) {
  if (!Number.isInteger(count) || count < 1 || count > 64)
    throw new Error("Invalid light sample count");
  const reference = Math.abs(light.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const e1 = normalize(cross(light, reference));
  const e2 = cross(light, e1);
  const spread = Math.tan((angularRadius * Math.PI) / 180);
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const radius = spread * Math.sqrt((i + 0.5) / count);
    const theta = i * golden;
    return normalize(step(step(light, e1, radius * Math.cos(theta)), e2, radius * Math.sin(theta)));
  });
}

/**
 * The affine map one light direction makes from a device plane onto the ground.
 * Orthographic camera + flat plane + directional light is exactly affine, so
 * this is a matrix, not an approximation. Returns undefined when the light
 * grazes the plane and the shadow is unbounded.
 */
export function shadowMatrix(phone, plane, direction, pz = 0) {
  const denominator = dot(plane.normal, direction);
  if (denominator > -0.02) return undefined;
  const cast = (px, py) => {
    const point = phone.world(px, py, pz);
    const t = (plane.offset - dot(plane.normal, point)) / denominator;
    return { x: point.x + direction.x * t, y: point.y + direction.y * t };
  };
  const origin = cast(0, 0);
  const dx = cast(1, 0);
  const dy = cast(0, 1);
  return [dx.x - origin.x, dx.y - origin.y, dy.x - origin.x, dy.y - origin.y, origin.x, origin.y];
}

const applyMatrix = (m, px, py) => ({ x: m[0] * px + m[2] * py + m[4], y: m[1] * px + m[3] * py + m[5] });

/** Every point a phone's shadow can reach, so the scene's bounds contain it. */
export function shadowExtent(phones, plane) {
  const points = [];
  for (const phone of phones)
    for (const direction of [...plane.samples, { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }]) {
      const matrix = shadowMatrix(phone, plane, direction, -phone.thickness);
      if (!matrix) continue;
      for (const [px, py] of phone.chassis) points.push(applyMatrix(matrix, px, py));
    }
  return points;
}

/**
 * The shadow layers for one phone, painted before ANY phone so a shadow can
 * never land on a chassis in front of it: the plane is behind them all.
 *
 * Each sample is the chassis silhouette - the same contour stroked outward by
 * the bezel that the shell uses - cast by one direction of the disc light.
 * Layer alpha is 1-(1-opacity)^(1/n), so full occlusion lands exactly on the
 * requested opacity while partial occlusion falls off monotonically with the
 * fraction of the source a point can still see. A small blur only removes the
 * banding between samples; it is not what makes the shadow soft.
 */
export function renderShadow(phone, { id, plane }) {
  if (!/^[a-zA-Z][\w-]*$/.test(id)) throw new Error("Invalid shadow ID");
  const directions = [
    ...plane.samples.map((direction) => ({ direction, weight: 1 })),
    // The ambient term: a hemisphere's worth of light is blocked straight down
    // the normal, which is the tight contact darkening under the chassis.
    { direction: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }, weight: 0.45 },
  ];
  const casts = directions
    .map(({ direction, weight }) => ({ matrix: shadowMatrix(phone, plane, direction, -phone.thickness), weight }))
    .filter((cast) => cast.matrix);
  if (!casts.length) return "";
  const alpha = 1 - (1 - plane.opacity) ** (1 / plane.samples.length);
  const origins = casts.map((cast) => ({ x: cast.matrix[4], y: cast.matrix[5] }));
  const centre = {
    x: origins.reduce((sum, point) => sum + point.x, 0) / origins.length,
    y: origins.reduce((sum, point) => sum + point.y, 0) / origins.length,
  };
  const penumbra = Math.max(...origins.map((point) => Math.hypot(point.x - centre.x, point.y - centre.y)));
  const blur = Math.max(1.5, (penumbra / plane.samples.length) * 1.4);
  const layers = casts
    .map(
      ({ matrix, weight }) =>
        `<use href="#${id}-silhouette" transform="matrix(${matrix.join(" ")})" fill="#000" stroke="#000" stroke-width="${phone.bezel * 2}" stroke-linejoin="round" fill-opacity="${alpha * weight}" stroke-opacity="${alpha * weight}"/>`,
    )
    .join("");
  return `<g class="phone-shadow" data-phone="${phone.index ?? 0}" aria-hidden="true" filter="url(#${id}-soften)">
    <defs>
      <path id="${id}-silhouette" d="${phone.screen}"/>
      <filter id="${id}-soften" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur}"/></filter>
    </defs>
    ${layers}
  </g>`;
}

export function createScene(captures, { preset = "custom", poses, shadow } = {}) {
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
      if (!/^(ios|android)\/[a-z0-9-]+$/.test(capture.key))
        throw new Error(
          "Scenes accept only registered ios/ or android/ screenshot references",
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
      const platform = capture.key.split('/')[0];
      const device = captureDevice(platform, capture.width, capture.height, capture.frameId);
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
          platform,
          frameId: capture.frameId,
        }),
        index,
      };
    })
    .sort((a, b) => a.z - b.z || a.index - b.index);
  // Shadows widen the scene, so they are part of the bounds rather than
  // something the viewBox clips off at the edges.
  const ground = shadow ? groundPlane(phones, shadow, chassisHeight) : undefined;
  return { phones, ...(ground ? { ground } : {}), ...sceneBounds(phones, 28, ground ? shadowExtent(phones, ground) : []) };
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
      <linearGradient id="${id}-edge" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#9aa093"/><stop offset=".45" stop-color="#5b6056"/><stop offset="1" stop-color="#8b9184"/></linearGradient>
      <clipPath id="${id}-screen" clipPathUnits="userSpaceOnUse"><path d="${screen}"/></clipPath>
    </defs>
    ${layers}${hardware}
    <g class="phone-front" transform="${matrix(0)}">
      ${surface(bezel, `url(#${id}-rim)`)}
      ${surface(bezel * (1 - FRAME_RAIL_SHARE), "#050606")}
      ${surface(Math.min(1.1, bezel * 0.09), `url(#${id}-edge)`)}
      ${underlay}
      <image class="phone-screen" width="${width}" height="${height}" href="${escape(href)}" preserveAspectRatio="none" clip-path="url(#${id}-screen)" data-source-width="${phone.imageWidth ?? width}" data-source-height="${phone.imageHeight ?? height}" data-radius="${phone.radius}"/>
    </g>
  </g>`;
}
