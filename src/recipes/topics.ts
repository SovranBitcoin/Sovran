import type { TagFilterInput } from './rank';

export type TopicTaxonomyNode = {
  value: string;
  parent?: string | null;
};

export function expandHideList(
  taxonomy: readonly TopicTaxonomyNode[],
  hiddenTopics: readonly string[]
): string[] {
  const hidden = new Set(hiddenTopics.filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    for (const topic of taxonomy) {
      if (!topic.value || hidden.has(topic.value)) continue;
      if (topic.parent && hidden.has(topic.parent)) {
        hidden.add(topic.value);
        changed = true;
      }
    }
  }
  return Array.from(hidden).sort();
}

export function derivedTopicExcludeFilter(values: readonly string[]): TagFilterInput | undefined {
  const excludeValues = Array.from(new Set(values.filter(Boolean))).sort();
  if (excludeValues.length === 0) return undefined;
  return {
    key: 'topic',
    dataset: 'DERIVED_TAGS',
    excludeValues,
  };
}
