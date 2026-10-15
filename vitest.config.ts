import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one FalkorDB cloud instance on the free tier.
    // Run serially so concurrent graph writes cannot interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
