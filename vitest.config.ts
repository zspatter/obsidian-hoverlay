import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			// the obsidian package is types-only with no runtime entry, so the
			// module id must be aliased to a stub for tests that load UI code
			obsidian: fileURLToPath(new URL("./src/testing/obsidian-stub.ts", import.meta.url)),
		},
	},
});
