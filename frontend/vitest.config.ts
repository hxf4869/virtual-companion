import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // TASK-0106 (P2-19): the Vue plugin lets component specs compile the .vue
  // page SFCs (chat/auth/memory glue). Pure logic specs keep the node
  // environment; component specs opt into happy-dom with a per-file
  // "@vitest-environment happy-dom" comment.
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
