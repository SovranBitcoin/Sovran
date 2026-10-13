/**
 * Which stories have to be played one after another on the same simulator.
 * A story that starts where another ends needs that one played first, on the
 * same wallet; handed to different workers, each would play the earlier
 * stories again for itself. A lane is a story nothing here leads up to, with
 * everything that follows from it, earlier before later.
 */
export function lanes<Story extends { id: string; startsFrom: string }>(
  stories: readonly Story[]
): Story[][] {
  const byId = new Map(stories.map((story) => [story.id, story]));
  /** The stories leading up to one, from the first; a state outside the set ends the walk. */
  const lineage = (story: Story): Story[] => {
    const line = [story];
    for (let before = byId.get(story.startsFrom); before; before = byId.get(before.startsFrom)) {
      if (line.includes(before)) break;
      line.unshift(before);
    }
    return line;
  };
  const grouped = new Map<string, Story[]>();
  for (const story of stories) {
    const first = lineage(story)[0].id;
    grouped.set(first, [...(grouped.get(first) ?? []), story]);
  }
  return [...grouped.values()]
    .map((lane) => lane.toSorted((a, b) => lineage(a).length - lineage(b).length))
    .toSorted((a, b) => b.length - a.length);
}
