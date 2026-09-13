// SemVer precedence: build metadata (+...) does not change precedence;
// prereleases (-...) precede a stable release with the same numeric core.
const VERSION =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = VERSION.exec(candidate);
  const b = VERSION.exec(current);
  if (!a || !b) return false;
  // Numeric prerelease identifiers cannot have leading zeroes.
  if ([a[4], b[4]].some((suffix) => suffix?.split('.').some((part) => /^0\d+$/.test(part))))
    return false;
  for (let i = 1; i <= 3; i++) {
    if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]);
  }
  if (a[4] === b[4]) return false;
  if (!a[4] || !b[4]) return !a[4];
  const left = a[4].split('.');
  const right = b[4].split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined || right[i] === undefined) return right[i] === undefined;
    if (left[i] === right[i]) continue;
    const ln = /^\d+$/.test(left[i]);
    const rn = /^\d+$/.test(right[i]);
    if (ln && rn) return BigInt(left[i]) > BigInt(right[i]);
    if (ln !== rn) return !ln;
    return left[i] > right[i];
  }
  return false;
}
