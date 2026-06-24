import update from 'lodash/fp/update';

type Primitive = string | number | boolean | symbol | null | undefined;

// ───────────────────────────────────────────────────────────────
// 1) Dot‑notation string paths
// ───────────────────────────────────────────────────────────────
type DotPath<T> = T extends Primitive
  ? never
  : {
      [K in Extract<keyof T, string>]: T[K] extends (infer U)[]
        ? `${K}` | `${K}.${Path<T[K]>}` | `${K}[${number}]` | `${K}[${number}].${Path<U>}`
        : T[K] extends object
          ? `${K}` | `${K}.${Path<T[K]>}`
          : `${K}`;
    }[Extract<keyof T, string>];

type Path<T> = DotPath<T>;

type PathValue<T, P extends string> = P extends `${infer Key}[${infer _I}].${infer Rest}`
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
type PathArray<T> = T extends Primitive
  ? never
  : {
      [K in Extract<keyof T, string>]: T[K] extends (infer U)[]
        ? [K] | [K, number] | [K, ...PathArray<U>] | [K, number, ...PathArray<U>]
        : T[K] extends object
          ? [K] | [K, ...PathArray<T[K]>]
          : [K];
    }[Extract<keyof T, string>];

type PathArrayValue<T, P extends readonly unknown[]> = P extends [infer K, ...infer Rest]
  ? K extends keyof T
    ? Rest extends [number, ...infer Sub]
      ? T[K] extends (infer U)[]
        ? Sub extends readonly unknown[]
          ? PathArrayValue<U, Sub>
          : U
        : never
      : Rest extends readonly unknown[]
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- implementation signature behind the two strongly-typed overloads above; it handles both string and tuple paths generically, so the loose impl types are intentional (callers get full safety from the overloads).
export function typedUpdate(path: any, updater: any, obj: any): any {
  return update(path, updater, obj);
}
