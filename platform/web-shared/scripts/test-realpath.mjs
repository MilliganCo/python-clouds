import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = realpathSync(path.resolve(here, ".."));
process.chdir(root);

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
const child = spawn(process.execPath, [vitestEntry, "run"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
