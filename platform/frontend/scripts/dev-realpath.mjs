import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = realpathSync(path.resolve(here, ".."));
process.chdir(frontendRoot);

const viteEntry = path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteEntry], {
  cwd: frontendRoot,
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
