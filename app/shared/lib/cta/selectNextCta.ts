import { BACKUP_SNOOZE_MS, CTA_DEFINITIONS } from './definitions';
import type { CtaContext, CtaDefinition } from './types';

export function selectNextCta(
  ctx: CtaContext,
  definitions = CTA_DEFINITIONS
): CtaDefinition | null {
  if (ctx.automation) return null;
  return (
    definitions
      .filter((cta) => {
        if (!cta.shouldShow(ctx)) return false;
        if (cta.dismissPolicy === 'never') return true;
        const applies = (entry: { at: number; version?: string; revision?: number } | undefined) =>
          entry &&
          entry.revision !== undefined &&
          entry.revision >= (cta.revision ?? 1) &&
          (entry.version === undefined || entry.version === ctx.latest?.version);
        const dismissal = ctx.dismissed[cta.id];
        if (applies(dismissal)) {
          if (cta.dismissPolicy === 'do-not-ask-again') return false;
          if (ctx.nowMs - dismissal.at < cta.dismissPolicy.snoozeMs) return false;
        }
        const snooze = ctx.dismissed[`${cta.id}:snooze`];
        const snoozeMs =
          typeof cta.dismissPolicy === 'object' ? cta.dismissPolicy.snoozeMs : BACKUP_SNOOZE_MS;
        return !(applies(snooze) && ctx.nowMs - snooze.at < snoozeMs);
      })
      .sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}
