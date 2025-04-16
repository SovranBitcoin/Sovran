export function compareSemver(version1: string, version2: string) {
  const version1Parts = version1.split(".").map(Number);
  const version2Parts = version2.split(".").map(Number);

  for (
    let i = 0;
    i < Math.max(version1Parts.length, version2Parts.length);
    i++
  ) {
    const part1 = version1Parts[i] || 0; // Default to 0 if missing
    const part2 = version2Parts[i] || 0;

    if (part1 > part2) return 1; // version1 is greater
    if (part1 < part2) return -1; // version2 is greater
  }
  return 0; // Versions are equal
}