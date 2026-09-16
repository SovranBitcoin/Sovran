export type AppSourceStamp = { fingerprint: string; gitSha: string; gitDirty: boolean };
export type CaptureFreshness = 'current' | 'outdated' | 'unverified' | 'withdrawn' | 'missing' | 'unknown';
export declare function appSourceFingerprint(root: string): string | undefined;
export declare function appSourceStamp(root: string): AppSourceStamp | undefined;
export declare function appFilesChangedSince(root: string, gitSha: string): string[] | undefined;
export declare function classifyCapture(
  entry: { run?: string | null; sha256?: string | null; availability?: string; freshness?: string; appSource?: { fingerprint?: string } } | undefined,
  currentFingerprint: string | undefined
): CaptureFreshness;
