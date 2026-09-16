import { validateRecipe } from './composition-recipe.mjs';

export function websiteScenes(config) {
  if (config.version !== 1 || !config.phones || !config.scenes || !Array.isArray(config.recipes)) throw new Error('Expected website config version 1.');
  return Object.fromEntries(Object.entries(config.scenes).map(([name, scene]) => {
    const phones = scene.phones.map(id => {
      if (!Object.hasOwn(config.phones, id)) throw new Error(`Unknown website phone: ${id}`);
      return config.phones[id];
    });
    return [name, { preset: scene.preset, phones, screenshots: phones.map(phone => phone.captureId) }];
  }));
}

export function websiteRecipes(config) {
  const scenes = websiteScenes(config);
  const outputs = new Set(), ids = new Set();
  return config.recipes.map(({ output, scene, ...input }) => {
    // Only the existing OG raster consumer is public. Add a consumer before
    // extending this allowlist; selection never implies a batch of mockups.
    if (output !== 'social/og.png' || outputs.has(output)) throw new Error(`Unapproved or duplicate website output: ${output}`);
    if (!Object.hasOwn(scenes, scene)) throw new Error(`Unknown website scene: ${scene}`);
    const recipe = validateRecipe({ ...input, preset: scenes[scene].preset, phones: scenes[scene].phones });
    if (recipe.draft) throw new Error('Public website recipes cannot be drafts.');
    if (ids.has(recipe.id)) throw new Error(`Duplicate website recipe: ${recipe.id}`);
    if (recipe.width !== 1200 || recipe.height !== 630) throw new Error('OG must be 1200 x 630.');
    outputs.add(output); ids.add(recipe.id);
    return { output, scene, recipe };
  });
}
