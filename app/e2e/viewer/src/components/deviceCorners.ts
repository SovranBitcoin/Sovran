/** UIScreen `_displayCornerRadius` + logical screen height (pt) per simulator
 * device type — the same radius the app reads at runtime through
 * expo-screen-corner-radius. Captures are square-cornered framebuffers; scaling
 * radiusPt/screenHeightPt by the rendered height rounds the frame exactly as
 * the hardware masks it, at any capture resolution. Unlisted devices (and
 * fake-driver runs, which carry no deviceType) keep square corners. */
const DEVICE_CORNERS: Record<string, { radiusPt: number; screenHeightPt: number }> = {
  'iPhone 17 Pro': { radiusPt: 62, screenHeightPt: 874 },
  'iPhone 17 Pro Max': { radiusPt: 62, screenHeightPt: 956 },
  'iPhone 17': { radiusPt: 62, screenHeightPt: 874 },
  'iPhone 16 Pro': { radiusPt: 62, screenHeightPt: 874 },
};

/** Keeps a media element's border radius true to hardware across resizes.
 * Returns the observer so callers can disconnect it on shell rebuilds. */
export function attachDeviceCorners(
  el: HTMLElement,
  deviceType: string | undefined
): ResizeObserver | undefined {
  const spec = deviceType ? DEVICE_CORNERS[deviceType] : undefined;
  if (!spec) return undefined;
  const apply = () => {
    if (!el.clientHeight) return;
    el.style.borderRadius = `${(el.clientHeight * spec.radiusPt) / spec.screenHeightPt}px`;
  };
  // the element box only tracks the media's aspect once dimensions are known
  el.addEventListener(el instanceof HTMLVideoElement ? 'loadedmetadata' : 'load', apply);
  const observer = new ResizeObserver(apply);
  observer.observe(el);
  return observer;
}
