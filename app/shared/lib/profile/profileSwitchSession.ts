/**
 * What a running account session registers so an in-process profile switch
 * can stop it: its services, and the provider boundary that holds the account
 * tree. Kept free of imports so a provider can register without pulling the
 * switch itself, and the stores it resets, into its module graph.
 */
const services = new Map<string, () => void | Promise<void>>();

export function registerProfileSwitchService(name: string, stop: () => void | Promise<void>) {
  services.set(name, stop);
  return () => {
    if (services.get(name) === stop) services.delete(name);
  };
}

/** The registered services, in registration order. */
export function profileSwitchServices(): ReadonlyMap<string, () => void | Promise<void>> {
  return services;
}

interface ProviderBoundary {
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
}
let boundary: ProviderBoundary | undefined;

export function registerProfileSwitchBoundary(value: ProviderBoundary): () => void {
  boundary = value;
  return () => {
    if (boundary === value) boundary = undefined;
  };
}

export function profileSwitchBoundary(): ProviderBoundary | undefined {
  return boundary;
}
