import update from 'lodash/fp/update';
import set from 'lodash/fp/set';

type Primitive = string | number | boolean | symbol | null | undefined;

// ───────────────────────────────────────────────────────────────
// 1) Dot‑notation string paths
// ───────────────────────────────────────────────────────────────
export type DotPath<T> = T extends Primitive
  ? never
  : {
    [K in Extract<keyof T, string>]: T[K] extends (infer U)[]
    ? `${K}` | `${K}.${Path<T[K]>}` | `${K}[${number}]` | `${K}[${number}].${Path<U>}`
    : T[K] extends object
    ? `${K}` | `${K}.${Path<T[K]>}`
    : `${K}`;
  }[Extract<keyof T, string>];

export type Path<T> = DotPath<T>;

export type PathValue<T, P extends string> = P extends `${infer Key}[${infer _I}].${infer Rest}`
  ? Key extends keyof T
  ? T[Key] extends (infer U)[]
  ? PathValue<U, Rest>
  : never
  : never
  : P extends `${infer Key}[${infer _I}]`
  ? Key extends keyof T
  ? T[Key] extends (infer U)[]
  ? U
  : never
  : never
  : P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
  ? PathValue<T[Key], Rest>
  : never
  : P extends keyof T
  ? T[P]
  : never;

// ───────────────────────────────────────────────────────────────
// 2) Tuple‑notation array paths
// ───────────────────────────────────────────────────────────────
export type PathArray<T> = T extends Primitive
  ? never
  : {
    [K in Extract<keyof T, string>]: T[K] extends (infer U)[]
    ? [K] | [K, number] | [K, ...PathArray<U>] | [K, number, ...PathArray<U>]
    : T[K] extends object
    ? [K] | [K, ...PathArray<T[K]>]
    : [K];
  }[Extract<keyof T, string>];

export type PathArrayValue<T, P extends readonly any[]> = P extends [infer K, ...infer Rest]
  ? K extends keyof T
  ? Rest extends [number, ...infer Sub]
  ? T[K] extends (infer U)[]
  ? Sub extends readonly any[]
  ? PathArrayValue<U, Sub>
  : U
  : never
  : Rest extends readonly any[]
  ? PathArrayValue<T[K], Rest>
  : T[K]
  : never
  : T;

// ───────────────────────────────────────────────────────────────
// 3) typedUpdate overloads & implementation
// ───────────────────────────────────────────────────────────────

/** String‑path overload */
export function typedUpdate<T, P extends Path<T>>(
  path: P,
  updater: (oldValue: PathValue<T, P>) => PathValue<T, P>,
  obj: T
): T;

/** Tuple‑path overload – accepts **readonly** or mutable tuples */
export function typedUpdate<T, P extends PathArray<T>>(
  path: readonly [...P],
  updater: (oldValue: PathArrayValue<T, P>) => PathArrayValue<T, P>,
  obj: T
): T;

/** Implementation */
export function typedUpdate(path: any, updater: any, obj: any): any {
  return update(path, updater, obj);
}

// ───────────────────────────────────────────────────────────────
// 4) typedSet (identical pattern)
// ───────────────────────────────────────────────────────────────

/** String‑path overload */
export function typedSet<T, P extends Path<T>>(path: P, value: PathValue<T, P>, obj: T): T;

/** Tuple‑path overload – accepts **readonly** or mutable tuples */
export function typedSet<T, P extends PathArray<T>>(
  path: readonly [...P],
  value: PathArrayValue<T, P>,
  obj: T
): T;

/** Implementation */
export function typedSet(path: any, value: any, obj: any): any {
  return set(path, value, obj);
}
