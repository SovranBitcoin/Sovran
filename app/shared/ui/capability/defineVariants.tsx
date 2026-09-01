/**
 * @fileoverview `defineVariants` — capability-keyed component dispatch.
 *
 * Replaces the `.ios.tsx` / `.android.tsx` / `.liquid.tsx` / `.fallback.tsx`
 * file-suffix sprawl. One component file registers its variants by
 * capability; the wrapper picks one per render based on `useCapabilities()`.
 *
 * Two forms:
 *
 * 1. Three-way literal (the 90% case):
 *    ```ts
 *    export const CapsuleButton = defineVariants('CapsuleButton', {
 *      liquid: CapsuleButtonLiquid,   // optional — used iff caps.liquidGlass
 *      blur:   CapsuleButtonBlur,     // optional — used iff caps.frostedSurface
 *      flat:   CapsuleButtonFlat,     // required — the floor
 *    });
 *    ```
 *    Dispatch order: `liquid > blur > flat`. `flat` is TS-required so the
 *    floor is never a missing-variant white screen.
 *
 * 2. Selector (escape hatch — for cases like `AmountFormatter` where
 *    a per-call-site `liquid` prop affects the choice):
 *    ```ts
 *    export const AmountFormatter = defineVariants<Props>('AmountFormatter',
 *      (caps, props) => props.liquid && caps.liquidGlass ? Liquid : Flat);
 *    ```
 *
 * The wrapper auto-attaches `<Log name={name}>` so log-doctor still sees
 * which surface rendered. Variant components MUST NOT include their own
 * `<Log>` (would double-nest).
 *
 * Discipline rule: only use `defineVariants` when the component has ≥2 real
 * visual paths. Single-axis components should call `useCapabilities()` and
 * branch inline (see `shared/ui/primitives/View/View.tsx`).
 *
 * Barrel convention for a component whose variants have platform-only deps:
 *
 *  - `index.ios.ts` / `index.android.ts` are BUNDLE entries. Their job is to
 *    keep a variant's native dependency (`@expo/ui/swift-ui`, `expo-blur`,
 *    `@react-native-menu/menu`, …) off the other platform's Metro graph.
 *  - Do NOT add a plain `index.ts` alongside them just to make the component
 *    resolvable from node. Jest runs `jest-expo/node` (`defaultPlatform: node`),
 *    so it would resolve that file in preference to both platform entries —
 *    and so does knip, which then reports every iOS-only variant the default
 *    table omits as an unused export. Tried on `BalancePill` and
 *    `UnitSwitcherPill`; knip immediately flagged `UNIT_SF_SYMBOLS`. The cost
 *    is a real hole in dead-code analysis for a component nothing imports
 *    from node anyway.
 *  - `CapsuleButton`, `CircleActionButton` and `SquircleView` do carry an
 *    `index.ts`; theirs predates this note and stays because their default
 *    table omits no exports. New split components should not copy it.
 *  - Consequence to know when writing tests: of the platform-split
 *    components, only `SquircleView` currently loads under Jest. Test the
 *    variant file (`X.flat.tsx`, `X.androidMenu.tsx`) directly instead of the
 *    barrel — that is what `androidUiRegressions.test.tsx` already does.
 */

import React from 'react';

import { Log } from '@/shared/lib/logger';

import { useCapabilities } from './index';
import type { Capabilities } from './types';

interface ThreeWay<P> {
  liquid?: React.ComponentType<P>;
  blur?: React.ComponentType<P>;
  flat: React.ComponentType<P>;
}

type Selector<P> = (caps: Capabilities, props: P) => React.ComponentType<P>;

function pickFromThreeWay<P>(variants: ThreeWay<P>, caps: Capabilities): React.ComponentType<P> {
  if (caps.liquidGlass && variants.liquid) return variants.liquid;
  if (caps.frostedSurface && variants.blur) return variants.blur;
  return variants.flat;
}

export function defineVariants<P extends object>(name: string, variants: ThreeWay<P>): React.FC<P>;
export function defineVariants<P extends object>(name: string, pick: Selector<P>): React.FC<P>;
export function defineVariants<P extends object>(
  name: string,
  variantsOrPick: ThreeWay<P> | Selector<P>
): React.FC<P> {
  const Component: React.FC<P> = (props) => {
    const caps = useCapabilities();
    const Picked =
      typeof variantsOrPick === 'function'
        ? variantsOrPick(caps, props)
        : pickFromThreeWay(variantsOrPick, caps);
    return (
      <Log name={name}>
        <Picked {...props} />
      </Log>
    );
  };
  Component.displayName = `Variants(${name})`;
  return Component;
}
