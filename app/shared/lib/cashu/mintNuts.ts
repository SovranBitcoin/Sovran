/**
 * Readers for a mint's NUT-06 `nuts` capability map as nagg's discover
 * endpoint ships it: VERBATIM and untyped (a plain JSON object keyed by NUT
 * number). nagg deliberately does not distill capabilities server-side — the
 * app derives whatever it needs here, so supporting a new NUT never requires
 * a server release.
 *
 * All readers are defensive: `nuts` comes from third-party mints via the
 * auditor, so shapes are treated as untrusted.
 */

export type MintNuts = Record<string, unknown>;

type NutMethod = { method?: string; unit?: string };

function methodsOf(nuts: MintNuts | undefined, nut: string): NutMethod[] {
  const entry = nuts?.[nut];
  if (!entry || typeof entry !== 'object') return [];
  const methods = (entry as { methods?: unknown }).methods;
  if (!Array.isArray(methods)) return [];
  return methods.filter((m): m is NutMethod => !!m && typeof m === 'object');
}

function uniqueLower(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = (value ?? '').trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Payment methods the mint advertises for MINTING (NUT-04): bolt11 per
 *  NUT-23, bolt12 per NUT-25, onchain non-standard. */
export function mintMethodsFromNuts(nuts: MintNuts | undefined): string[] {
  return uniqueLower(methodsOf(nuts, '4').map((m) => m.method));
}

/** Payment methods the mint advertises for MELTING (NUT-05). */
export function meltMethodsFromNuts(nuts: MintNuts | undefined): string[] {
  return uniqueLower(methodsOf(nuts, '5').map((m) => m.method));
}

/**
 * Whether the mint advertises a boolean-style NUT (e.g. '7' state check,
 * '9' restore, '10'/'11' P2PK, '12' DLEQ, '20' signed mint quotes). NUT-17
 * (websockets) expresses support as a non-empty `supported` array — both
 * forms count.
 */
export function nutSupported(nuts: MintNuts | undefined, nut: string): boolean {
  const entry = nuts?.[nut];
  if (!entry || typeof entry !== 'object') return false;
  const supported = (entry as { supported?: unknown }).supported;
  if (supported === true) return true;
  if (Array.isArray(supported)) return supported.length > 0;
  return false;
}
