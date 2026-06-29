/**
 * Run `cb` after the next layout pass (two animation frames) so freshly mounted
 * content has been measured before the caller acts on it.
 *
 * Used by the bottom-sheet hosts (ActionMenuHost / PopupHost): they mount the
 * sheet closed and then flip it open, but gorhom's dynamic sizing needs the
 * content's `onLayout` to fire first — opening on the next JS tick races that
 * measurement and the sheet snaps to a partial height. Waiting two frames lets
 * the layout + measurement land so the sheet opens to its full content height.
 *
 * Falls back to `setTimeout` where `requestAnimationFrame` is unavailable (e.g.
 * the jest node test environment). Returns a cancel function.
 */
export function scheduleAfterLayout(cb: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    const timer = setTimeout(cb, 0);
    return () => clearTimeout(timer);
  }
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(cb);
  });
  return () => {
    cancelAnimationFrame(outer);
    if (inner) cancelAnimationFrame(inner);
  };
}
