import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary"],
      // Floors, a little under what the tests reach today.
      thresholds: { lines: 65 },
    },
  },
});
