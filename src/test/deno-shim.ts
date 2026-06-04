// Shim just enough of the Deno runtime to run the `_shared` safety suite under
// vitest/Node. The suite was written as `deno test`, but the user's machine has
// no Deno (and egress blocks installing it), so these 150 money-protecting
// invariant tests would otherwise never run in `npm test`. This maps
// `Deno.test(name, fn)` onto vitest's global `test`, and backs `Deno.env` with
// an in-memory store (the suite sets/deletes its own env per case).
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;

if (!g.Deno) {
  g.Deno = {
    env: {
      get: (k: string) => store.get(k),
      set: (k: string, v: string) => void store.set(k, String(v)),
      delete: (k: string) => void store.delete(k),
      has: (k: string) => store.has(k),
      toObject: () => Object.fromEntries(store),
    },
    // Defer to vitest's global `test` at call time so registration lands in the
    // currently-collecting file.
    test: (name: string, fn: (...args: unknown[]) => unknown) =>
      (g.test as (n: string, f: unknown) => void)(name, fn),
  };
}
