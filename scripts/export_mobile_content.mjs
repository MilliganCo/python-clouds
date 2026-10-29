import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadWindowObject(relativePath, globalName) {
  const sandbox = { window: Object.create(null) };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath, timeout: 5000 });
  const value = sandbox.window[globalName];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${relativePath} не объявил window.${globalName}`);
  }
  return value;
}

const theory = loadWindowObject("platform/static/theory.js", "THEORY");
const articleFiles = [
  "platform/static/theory-articles-0-6.js",
  "platform/static/theory-articles-7-12.js",
  "platform/static/theory-articles-13-25.js",
  "platform/static/theory-articles-26-39.js",
  "platform/static/theory-articles-40-50.js",
  "platform/static/theory-articles-52-53.js",
  "platform/static/theory-articles-54.js",
  "platform/static/theory-articles-55.js",
  "platform/static/theory-articles-56.js",
  "platform/static/theory-articles-57.js",
  "platform/static/theory-articles-58.js",
  "platform/static/theory-articles-59.js",
  "platform/static/theory-articles-60.js",
  "platform/static/theory-articles-61.js",
  "platform/static/theory-articles-62.js",
  "platform/static/theory-articles-63.js",
  "platform/static/theory-articles-64.js",
  "platform/static/theory-articles-65.js",
];
const articles = {};
for (const file of articleFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  Object.assign(articles, loadWindowObject(file, "THEORY_ARTICLES"));
}

// Статья перекрывает короткий THEORY, сохраняя teaser-поля text/example.
const mergedTheory = {};
for (const [key, short] of Object.entries(theory)) {
  const art = articles[key] || articles[Number(key)];
  if (!art) {
    mergedTheory[key] = short;
    continue;
  }
  const firstExample = art.sections?.[0]?.examples?.[0]?.code ?? short.example ?? null;
  mergedTheory[key] = {
    ...art,
    text: art.lead || short.text || "",
    example: firstExample,
  };
}

const output = {
  theory: mergedTheory,
  hints: loadWindowObject("platform/static/hints.js", "TASK_HINTS"),
  intros: loadWindowObject("platform/static/task-intros.js", "TASK_INTRO"),
  checks: loadWindowObject("platform/static/checks.js", "CHECKS"),
};

process.stdout.write(JSON.stringify(output));
