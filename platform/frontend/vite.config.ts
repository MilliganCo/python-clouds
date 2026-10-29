import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = realpathSync(configDir);
const contentBundlePath = realpathSync(
  path.resolve(rootDir, "../../android/app/src/main/assets/content/content-bundle.json"),
);
const contentBundleDir = path.dirname(contentBundlePath);
const legacyMinigamePath = realpathSync(
  path.resolve(rootDir, "../static/minigame.js"),
);
const legacyInsightsPath = realpathSync(
  path.resolve(rootDir, "../static/insights.js"),
);

export default defineConfig({
  root: rootDir,
  plugins: [
    react(),
    {
      name: "legacy-minigame-export",
      enforce: "pre",
      transform(code, id) {
        const norm = id.replace(/\\/g, "/");
        if (!norm.endsWith("/static/minigame.js")) return null;
        return {
          code:
            code +
            "\nexport const Blitz = window.Blitz;" +
            "\nexport const OrderGame = window.OrderGame;" +
            "\nexport const MatchGame = window.MatchGame;" +
            "\nexport const TraceGame = window.TraceGame;" +
            "\nexport const FillGame = window.FillGame;\n",
          map: null,
        };
      },
    },
    {
      name: "legacy-insights-export",
      enforce: "pre",
      transform(code, id) {
        const norm = id.replace(/\\/g, "/");
        if (!norm.endsWith("/static/insights.js")) return null;
        return {
          code: code + "\nexport default window.TOPIC_INSIGHT;\n",
          map: null,
        };
      },
    },
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@shared": path.resolve(rootDir, "../web-shared/src"),
      "@legacy-styles": path.resolve(rootDir, "../static/styles.css"),
      "@content-bundle": contentBundlePath,
      "@legacy-minigame": legacyMinigamePath,
      "@legacy-insights": legacyInsightsPath,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 8018,
    strictPort: true,
    fs: {
      allow: [
        rootDir,
        path.resolve(rootDir, "../static"),
        path.resolve(rootDir, "../web-shared"),
        contentBundleDir,
      ],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8017", changeOrigin: false },
      // Same-origin Pyodide for classic worker importScripts under COEP
      "/pyodide": {
        target: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full",
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/pyodide/, ""),
        headers: {
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: [path.resolve(rootDir, "src/test/setup.ts")],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
});
