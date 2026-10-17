import { z } from 'zod';

const text = z.string().trim().min(1);
export const role = z.enum(['research', 'implementation', 'review', 'adversary', 'audit', 'diversityReview']);
export const model = z.object({
  provider: text, model: text, options: z.record(text, z.union([text, z.boolean()])).optional(),
});
const catalogOption = z.discriminatedUnion('type', [
  z.object({ id: text, type: z.literal('select'), options: z.array(z.object({ id: text })) }),
  z.object({ id: text, type: z.literal('boolean') }),
]);
export const modelCatalog = z.object({ observedAt: z.iso.datetime(), providers: z.array(z.object({
    providerInstanceId: text, driverKind: text, canRunChildTask: z.boolean(),
    models: z.array(z.object({ id: text, options: z.array(catalogOption).nullish() })),
  })) });
const routedModels = z.object({
  kind: z.literal('routed'), allowGptOnly: z.boolean(), catalog: modelCatalog,
  // Added later: tasks sealed before it was approved keep no Claude-only authority.
  allowClaudeOnly: z.boolean().optional(),
  routes: z.record(role, z.object({ purpose: text, candidates: z.array(model).min(1).max(4) })),
});
const legacyModels = z.object({ research: model, implementation: model, review: model, adversary: model, audit: model });

// Old sealed tasks retain single-target authority. Only a routed policy authorizes replacements.
export const models = z.union([routedModels, legacyModels]).superRefine((policy, ctx) => {
  if (!('kind' in policy)) {
    if (policy.implementation.provider === policy.review.provider)
      ctx.addIssue({ code: 'custom', message: 'Implementation and independent review must use different providers' });
    return;
  }
  for (const route of Object.values(policy.routes)) for (const target of route.candidates) {
    const provider = policy.catalog.providers.find(p => p.providerInstanceId === target.provider);
    const supported = provider?.models.find(m => m.id === target.model);
    if (!provider?.canRunChildTask || !supported) {
      ctx.addIssue({ code: 'custom', message: `Unavailable model: ${target.provider}/${target.model}` });
      continue;
    }
    const effortKey = provider.driverKind === 'codex' ? 'reasoningEffort' : provider.driverKind === 'claudeAgent' ? 'effort' : null;
    if (!effortKey || typeof target.options?.[effortKey] !== 'string')
      ctx.addIssue({ code: 'custom', message: 'Routed models require explicit supported reasoning effort' });
    for (const [id, value] of Object.entries(target.options ?? {})) {
      const option = supported.options?.find(o => o.id === id);
      if (!option || (option.type === 'boolean' ? typeof value !== 'boolean' : !option.options.some(o => o.id === value)))
        ctx.addIssue({ code: 'custom', message: `Unsupported model option: ${target.provider}/${target.model} ${id}` });
    }
  }
});
type Models = z.infer<typeof models>;
type Role = z.infer<typeof role>;
export type Model = z.infer<typeof model>;

// A parsed T3 task result is coordinator evidence, not a worker's self-description.
export const runtimeTask = z.object({
  taskId: text, providerInstanceId: text, model: text.nullable(),
  status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted']),
  workState: z.enum(['working', 'waiting_for_children', 'result_available']),
  hasPendingChildRuns: z.boolean(), hasPendingQuestion: z.boolean(), summary: z.string().nullable().optional(),
});
export const availability = z.enum(['quota-exhausted', 'rate-limited', 'capacity-unavailable', 'model-unavailable']);
export const dispatchRejection = z.object({
  kind: z.literal('definitively-not-created'), requestId: text,
  evidence: z.object({ code: text, message: text }),
});
export type RuntimeTask = z.infer<typeof runtimeTask>;

/**
 * A provider or model a worker found unavailable, and until when to skip it.
 * Recorded by `fallback`, so the next task's policy starts with what works
 * instead of spending a dispatch per ticket rediscovering an exhausted quota.
 */
export const outage = z.object({
  provider: text, model: text, reason: availability, until: z.iso.datetime(), detail: text,
});
export type Outage = z.infer<typeof outage>;
/** How long each kind of unavailability is assumed to last when the provider names no time. */
export const OUTAGE_MS: Record<z.infer<typeof availability>, number> = {
  'quota-exhausted': 24 * 3_600_000, 'rate-limited': 3_600_000,
  'capacity-unavailable': 3_600_000, 'model-unavailable': 24 * 3_600_000,
};
/** A quota covers every model of its provider; the others are one model's. */
const covers = (o: Outage, m: Model) =>
  o.provider === m.provider && (o.reason === 'quota-exhausted' || o.model === m.model);

export function candidates(policy: Models, selectedRole: Role): Model[] {
  if ('kind' in policy) return policy.routes[selectedRole].candidates;
  return selectedRole === 'diversityReview' ? [] : [policy[selectedRole]];
}

export function driver(policy: Models, target: Model) {
  return 'kind' in policy ? policy.catalog.providers.find(p => p.providerInstanceId === target.provider)?.driverKind : undefined;
}

/** Initial hypotheses from the linked research, to be measured on local tasks.
 * The live catalog must support every choice; there is no silent option downgrade. */
export function recommendedModels(catalog: unknown, outages: Outage[] = []) {
  const sol = { provider: 'codex', model: 'gpt-6.1-sol', options: { reasoningEffort: 'high' } };
  const astra = { provider: 'codex', model: 'gpt-6-astra', options: { reasoningEffort: 'high' } };
  const opus = { provider: 'claudeAgent', model: 'claude-opus-5-5', options: { effort: 'high' } };
  const fable = { provider: 'claudeAgent', model: 'claude-fable-5-1', options: { effort: 'high' } };
  const observedAt = Date.parse(modelCatalog.parse(catalog).observedAt);
  const current = outages.filter(o => Date.parse(o.until) > observedAt);
  const policy = models.parse({ kind: 'routed', allowGptOnly: true, allowClaudeOnly: true, catalog,
    routes: {
      research: { purpose: 'Bounded evidence extraction, escalating to the coding model, then across providers, when unavailable', candidates: [
        { provider: 'codex', model: 'gpt-6-luna', options: { reasoningEffort: 'high' } }, sol, opus,
      ] },
      implementation: { purpose: 'Coding work with a cross-provider availability replacement', candidates: [sol, opus] },
      review: { purpose: 'Fresh cross-provider correctness review, with disclosed GPT fallback', candidates: [opus, sol] },
      adversary: { purpose: 'Counterexamples and test-validity challenges; model advantage remains an evaluation question', candidates: [fable, astra] },
      audit: { purpose: 'Final rules and evidence reconciliation', candidates: [opus, sol] },
      diversityReview: { purpose: 'Extra single-provider review by a model outside the complete source-author model set', candidates: [astra, fable] },
    },
  });
  if (!('kind' in policy)) return policy;
  for (const [name, route] of Object.entries(policy.routes)) {
    route.candidates = route.candidates.filter(m => !current.some(o => covers(o, m)));
    if (!route.candidates.length) throw new Error(`No available model for ${name}: ${current.map(o => `${o.provider}/${o.model} ${o.reason} until ${o.until}`).join('; ')}`);
  }
  return policy;
}
