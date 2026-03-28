/** 仅在此文件内使用 x == null 判断空值，业务代码请用 isNil / isNotNil。 */
export function isNil(x: unknown): x is null | undefined {
  return x == null;
}

export function isNotNil<T>(x: T | null | undefined): x is T {
  return !isNil(x);
}
