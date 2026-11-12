import type { ReleaseObservation } from './releases';

/** Once any build can be installed, its disk fixture is immutable even when still newest. */
export function fixturesRequiringFreeze<T extends { versions: readonly string[] }>(
  fixtures: readonly T[],
  observations: readonly ReleaseObservation[]
): T[] {
  return fixtures.filter(
    (fixture, index) =>
      index < fixtures.length - 1 ||
      observations.some(
        (release) =>
          release.evidence !== 'release-only' && fixture.versions.includes(release.version)
      )
  );
}
