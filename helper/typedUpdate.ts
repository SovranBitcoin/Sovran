import _ from 'lodash/fp';

type PathImpl<T, Key extends keyof T> =
  Key extends string
  ? T[Key] extends Record<string, any>
  ? | `${Key}.${PathImpl<T[Key], Exclude<keyof T[Key], keyof any[]>> & string}`
  | `${Key}.${Exclude<keyof T[Key], keyof any[]> & string}`
  : never
  : never;

type Path<T> = PathImpl<T, keyof T> | keyof T;

type PathValue<T, P extends Path<T>> =
  P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
  ? Rest extends Path<T[Key]>
  ? PathValue<T[Key], Rest>
  : never
  : never
  : P extends keyof T
  ? T[P]
  : never;

export function typedUpdate<T, P extends Path<T> & string>(
  path: P,
  updater: (value: PathValue<T, P>) => PathValue<T, P>,
  obj: T
): T {
  return _.update(path, updater, obj as object);
}