import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // deno-shim must load first so `globalThis.Deno` exists before the `_shared`
    // suite's top-level `Deno.test(...)` calls run during collection.
    setupFiles: ["./src/test/deno-shim.ts", "./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/_shared/**/*.test.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
