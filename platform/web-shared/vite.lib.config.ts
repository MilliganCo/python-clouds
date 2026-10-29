import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(rootDir, "src/tasks/index.ts"),
      name: "PyCloudTasks",
      formats: ["iife"],
      fileName: () => "web-shared-tasks.js",
    },
    outDir: path.resolve(rootDir, "../static/generated"),
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
  },
});
