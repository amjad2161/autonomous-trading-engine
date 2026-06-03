// Minimal local assertion helpers so the _shared test suites run fully offline
// (the egress policy blocks deno.land/std). API-compatible with the subset of
// @std/assert used by the tests. Not a function module; imported by *.test.ts only.

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function assert(expr: unknown, msg = "assertion failed"): asserts expr {
  if (!expr) throw new AssertionError(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(msg ?? `assertEquals failed: ${a} !== ${e}`);
}

export function assertAlmostEquals(actual: number, expected: number, tolerance = 1e-7, msg?: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new AssertionError(msg ?? `assertAlmostEquals failed: |${actual} - ${expected}| > ${tolerance}`);
  }
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertThrows(fn: () => unknown, ErrorClass?: any, msgIncludes?: string, msg?: string): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    if (ErrorClass && !(err instanceof ErrorClass)) {
      throw new AssertionError(msg ?? `assertThrows: wrong error type (${(err as Error)?.name})`);
    }
    if (msgIncludes && !String((err as Error)?.message ?? "").includes(msgIncludes)) {
      throw new AssertionError(msg ?? `assertThrows: message missing "${msgIncludes}"`);
    }
  }
  if (!threw) throw new AssertionError(msg ?? "assertThrows: function did not throw");
}
