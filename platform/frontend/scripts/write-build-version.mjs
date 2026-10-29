import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, "../dist");
if (!existsSync(dist)) {
  console.error("write-build-version: dist/ missing — run vite build first");
  process.exit(1);
}

let version = (process.env.PYCLOUD_FRONTEND_BUILD || "").trim();
if (!version) {
  try {
    version = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      cwd: path.resolve(root, "../.."),
    }).trim();
  } catch {
    version = new Date().toISOString().slice(0, 10);
  }
}

mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "build-version.txt"), version + "\n", "utf8");
console.log("build-version.txt →", version);
