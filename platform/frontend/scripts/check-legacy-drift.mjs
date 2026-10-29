/**
 * Detect drift between legacy (:8017) sources and React hand-ports / baselines.
 *
 * Usage:
 *   node scripts/check-legacy-drift.mjs           # check (exit 1 on drift)
 *   node scripts/check-legacy-drift.mjs --update  # rewrite baseline hashes
 *   node scripts/check-legacy-drift.mjs --json    # machine-readable report
 *
 * Two layers:
 * 1) SHA-256 baseline of watched legacy files (tasks, theory, styles, app.js, …)
 * 2) Structural contracts extracted from legacy vs React copies
 *    (POINTS, RANKS, look lists, sky scroll formula, challenge XP ids)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const PLATFORM = path.resolve(FRONTEND, "..");
const REPO = path.resolve(PLATFORM, "..");
const BASELINE_PATH = path.join(FRONTEND, "migration", "legacy-baseline.json");

const args = new Set(process.argv.slice(2));
const DO_UPDATE = args.has("--update");
const AS_JSON = args.has("--json");

/** @typedef {{ id: string, rel: string, category: string, note?: string }} WatchEntry */

/** @type {WatchEntry[]} */
const WATCHED = [
  {
    id: "styles",
    rel: "platform/static/styles.css",
    category: "auto-ui",
    note: "React imports via @legacy-styles — visual may change without TS edits",
  },
  {
    id: "app-js",
    rel: "platform/static/app.js",
    category: "hand-port",
    note: "POINTS/RANKS/sky scroll/look lists may need React sync",
  },
  {
    id: "index-html",
    rel: "platform/static/index.html",
    category: "chrome",
  },
  {
    id: "tasks-js",
    rel: "platform/static/tasks.js",
    category: "content",
    note: "Rebuild content-bundle after task edits",
  },
  {
    id: "tasks-meta",
    rel: "platform/tasks_meta.json",
    category: "content",
  },
  {
    id: "content-bundle",
    rel: "android/app/src/main/assets/content/content-bundle.json",
    category: "auto-content",
    note: "React theory reads this alias @content-bundle",
  },
  {
    id: "theory-js",
    rel: "platform/static/theory.js",
    category: "content",
  },
  {
    id: "theory-0-6",
    rel: "platform/static/theory-articles-0-6.js",
    category: "content",
  },
  {
    id: "theory-7-12",
    rel: "platform/static/theory-articles-7-12.js",
    category: "content",
  },
  {
    id: "theory-13-25",
    rel: "platform/static/theory-articles-13-25.js",
    category: "content",
  },
  {
    id: "theory-26-39",
    rel: "platform/static/theory-articles-26-39.js",
    category: "content",
  },
  {
    id: "theory-40-50",
    rel: "platform/static/theory-articles-40-50.js",
    category: "content",
  },
  {
    id: "challenges",
    rel: "platform/static/challenges.js",
    category: "hand-port",
    note: "Sync challengesMeta.ts XP ids",
  },
  {
    id: "insights",
    rel: "platform/static/insights.js",
    category: "content",
    note: "TOPIC_INSIGHT — port when Topics catalog reaches full parity",
  },
  {
    id: "minigame",
    rel: "platform/static/minigame.js",
    category: "content",
  },
  {
    id: "project-courses",
    rel: "platform/static/project-courses.js",
    category: "content",
  },
  {
    id: "runner-worker-legacy",
    rel: "platform/static/runner-worker.js",
    category: "hand-port",
    note: "Keep frontend public/runner-worker.js protocol in sync",
  },
];

function abs(rel) {
  return path.join(REPO, rel);
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readUtf8(rel) {
  return fs.readFileSync(abs(rel), "utf8");
}

function extractJsStringArray(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const m = source.match(re);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractPoints(source) {
  const m = source.match(/const\s+POINTS\s*=\s*\{([^}]+)\}/);
  if (!m) throw new Error("POINTS not found in app.js");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) {
    out[k] = Number(v);
  }
  return out;
}

function extractRanks(source) {
  const m = source.match(/const\s+RANKS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("RANKS not found in app.js");
  const ranks = [];
  for (const [, name, min] of m[1].matchAll(
    /\{\s*name:\s*"([^"]+)"\s*,\s*min:\s*(\d+)\s*\}/g,
  )) {
    ranks.push({ name, min: Number(min) });
  }
  if (!ranks.length) throw new Error("RANKS empty");
  return ranks;
}

function extractSkyScrollSnippet(source) {
  const m = source.match(
    /Math\.pow\(\s*Math\.min\(\s*1\s*,\s*p\s*\/\s*0\.75\s*\)\s*,\s*1\.05\s*\)/,
  );
  if (!m) throw new Error("sky scroll ease formula not found in app.js");
  return "pow(min(1,p/0.75),1.05)";
}

function extractChallengeIds(source) {
  return [...source.matchAll(/\bid:\s*"(C\d+\.\d+)"/g)].map((x) => x[1]);
}

function extractChallengeMetaFromTs(source) {
  return [...source.matchAll(/id:\s*"(C\d+\.\d+)"\s*,\s*topicId:\s*(\d+)/g)].map(
    (x) => ({ id: x[1], topicId: Number(x[2]) }),
  );
}

/** TOPIC_SYMBOL from app.js — keys 0..50 */
function extractTopicSymbol(source) {
  const m = source.match(/const\s+TOPIC_SYMBOL\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!m) throw new Error("TOPIC_SYMBOL not found in app.js");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\d+)\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    out[Number(k)] = v.replace(/\\"/g, '"');
  }
  for (const [, k, v] of m[1].matchAll(/(\d+)\s*:\s*'((?:\\.|[^'\\])*)'/g)) {
    out[Number(k)] = v.replace(/\\'/g, "'");
  }
  return out;
}

function extractTopicSymbolFromTs(source) {
  const m = source.match(
    /export const TOPIC_SYMBOL[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!m) throw new Error("TOPIC_SYMBOL not found in topicCatalogMeta.ts");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\d+)\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    out[Number(k)] = v.replace(/\\"/g, '"');
  }
  // also match single-quoted entries like 25: '"{}"'
  for (const [, k, v] of m[1].matchAll(/(\d+)\s*:\s*'((?:\\.|[^'\\])*)'/g)) {
    out[Number(k)] = v.replace(/\\'/g, "'");
  }
  return out;
}

function extractLevelOrder(source) {
  const m = source.match(/const\s+LEVEL_ORDER\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error("LEVEL_ORDER not found");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractLevelOrderFromTs(source) {
  const m = source.match(/export const LEVEL_ORDER = \[([\s\S]*?)\] as const/);
  if (!m) throw new Error("LEVEL_ORDER not found in topicCatalogMeta.ts");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractLevelTitle(source) {
  const m = source.match(/const\s+LEVEL_TITLE\s*=\s*\{([^}]+)\}/);
  if (!m) throw new Error("LEVEL_TITLE not found");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) {
    out[k] = v;
  }
  return out;
}

function extractLevelTitleFromTs(source) {
  const m = source.match(
    /export const LEVEL_TITLE[^=]*=\s*\{([^}]+)\}/,
  );
  if (!m) throw new Error("LEVEL_TITLE not found in topicCatalogMeta.ts");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) {
    out[k] = v;
  }
  return out;
}

function extractTsPoints(source) {
  const m = source.match(/export const POINTS = \{([^}]+)\}/);
  if (!m) throw new Error("POINTS not found in rankProgress.ts");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\w+):\s*(\d+)/g)) {
    out[k] = Number(v);
  }
  return out;
}

function extractTsRanks(source) {
  const m = source.match(/export const RANKS = \[([\s\S]*?)\] as const/);
  if (!m) throw new Error("RANKS not found in rankProgress.ts");
  const ranks = [];
  for (const [, name, min] of m[1].matchAll(
    /\{\s*name:\s*"([^"]+)"\s*,\s*min:\s*(\d+)\s*\}/g,
  )) {
    ranks.push({ name, min: Number(min) });
  }
  return ranks;
}

function extractTsStringArray(source, name) {
  const re = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`);
  const m = source.match(re);
  if (!m) throw new Error(`${name} not found in lookPreferences.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkContracts() {
  const app = readUtf8("platform/static/app.js");
  const challenges = readUtf8("platform/static/challenges.js");
  const rankTs = readUtf8("platform/frontend/src/services/rankProgress.ts");
  const lookTs = readUtf8("platform/frontend/src/services/lookPreferences.ts");
  const skyTs = readUtf8("platform/frontend/src/services/skyScroll.ts");
  const chMetaTs = readUtf8("platform/frontend/src/content/challengesMeta.ts");

  /** @type {{ id: string, ok: boolean, detail: string }[]} */
  const results = [];

  const pointsL = extractPoints(app);
  const pointsR = extractTsPoints(rankTs);
  results.push({
    id: "POINTS",
    ok: deepEqual(pointsL, pointsR),
    detail: okDetail(deepEqual(pointsL, pointsR), pointsL, pointsR),
  });

  const ranksL = extractRanks(app);
  const ranksR = extractTsRanks(rankTs);
  results.push({
    id: "RANKS",
    ok: deepEqual(ranksL, ranksR),
    detail: okDetail(deepEqual(ranksL, ranksR), ranksL, ranksR),
  });

  for (const name of ["SKY_SKINS", "TERM_THEMES", "FX_OVERLAYS"]) {
    const L = extractJsStringArray(app, name).sort();
    const R = extractTsStringArray(lookTs, name).slice().sort();
    results.push({
      id: name,
      ok: deepEqual(L, R),
      detail: okDetail(deepEqual(L, R), L, R),
    });
  }

  const formulaL = extractSkyScrollSnippet(app);
  const hasFormulaR = /Math\.pow\(\s*Math\.min\(\s*1\s*,\s*p\s*\/\s*0\.75\s*\)\s*,\s*1\.05\s*\)/.test(
    skyTs,
  );
  results.push({
    id: "sky-scroll-formula",
    ok: hasFormulaR,
    detail: hasFormulaR
      ? `ok (${formulaL})`
      : `React skyScroll.ts missing legacy formula ${formulaL}`,
  });

  const challengeIdsL = extractChallengeIds(challenges);
  const challengeMetaR = extractChallengeMetaFromTs(chMetaTs);
  const idsR = challengeMetaR.map((x) => x.id);
  const idsOk = deepEqual(challengeIdsL, idsR);
  results.push({
    id: "challenge-xp-ids",
    ok: idsOk,
    detail: okDetail(idsOk, challengeIdsL, idsR),
  });

  // topicId consistency from challenges.js
  const topicPairsL = [
    ...challenges.matchAll(/\bid:\s*"(C\d+\.\d+)"\s*,\s*topicId:\s*(\d+)/g),
  ].map((m) => ({ id: m[1], topicId: Number(m[2]) }));
  const topicsOk = deepEqual(topicPairsL, challengeMetaR);
  results.push({
    id: "challenge-xp-topicIds",
    ok: topicsOk,
    detail: okDetail(topicsOk, topicPairsL, challengeMetaR),
  });

  const catalogTs = readUtf8(
    "platform/frontend/src/content/topicCatalogMeta.ts",
  );
  const symbolL = extractTopicSymbol(app);
  const symbolR = extractTopicSymbolFromTs(catalogTs);
  const symbolKeysL = Object.keys(symbolL)
    .map(Number)
    .sort((a, b) => a - b);
  const symbolKeysR = Object.keys(symbolR)
    .map(Number)
    .sort((a, b) => a - b);
  const symbolCountOk =
    symbolKeysL.length === 52 && deepEqual(symbolKeysL, symbolKeysR);
  results.push({
    id: "TOPIC_SYMBOL-count",
    ok: symbolCountOk,
    detail: symbolCountOk
      ? `ok (${symbolKeysL.length} keys 0..51)`
      : okDetail(false, symbolKeysL, symbolKeysR),
  });
  // Sample parity: ids 0, 13, 26, 51 (shifted +1 from 12/25/50 after the
  // 2026-07-21 curriculum insert of Topic 3 "Первые функции")
  const sampleIds = [0, 13, 26, 51];
  const sampleL = Object.fromEntries(sampleIds.map((id) => [id, symbolL[id]]));
  const sampleR = Object.fromEntries(sampleIds.map((id) => [id, symbolR[id]]));
  const sampleOk = deepEqual(sampleL, sampleR);
  results.push({
    id: "TOPIC_SYMBOL-sample",
    ok: sampleOk,
    detail: okDetail(sampleOk, sampleL, sampleR),
  });

  const levelOrderL = extractLevelOrder(app);
  const levelOrderR = extractLevelOrderFromTs(catalogTs);
  const levelOrderOk = deepEqual(levelOrderL, levelOrderR);
  results.push({
    id: "LEVEL_ORDER",
    ok: levelOrderOk,
    detail: okDetail(levelOrderOk, levelOrderL, levelOrderR),
  });

  const levelTitleL = extractLevelTitle(app);
  const levelTitleR = extractLevelTitleFromTs(catalogTs);
  const levelTitleOk = deepEqual(levelTitleL, levelTitleR);
  results.push({
    id: "LEVEL_TITLE",
    ok: levelTitleOk,
    detail: okDetail(levelTitleOk, levelTitleL, levelTitleR),
  });

  return results;
}

function okDetail(ok, left, right) {
  if (ok) return "ok";
  return `legacy=${JSON.stringify(left)} react=${JSON.stringify(right)}`;
}

function buildHashes() {
  /** @type {Record<string, { sha256: string, bytes: number, category: string, note?: string }>} */
  const files = {};
  const missing = [];
  for (const entry of WATCHED) {
    const filePath = abs(entry.rel);
    if (!fs.existsSync(filePath)) {
      missing.push(entry);
      continue;
    }
    const st = fs.statSync(filePath);
    files[entry.id] = {
      sha256: sha256File(filePath),
      bytes: st.size,
      category: entry.category,
      rel: entry.rel,
      ...(entry.note ? { note: entry.note } : {}),
    };
  }
  return { files, missing };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(hashes) {
  const payload = {
    generatedAt: new Date().toISOString(),
    note: "Update with: npm run check:legacy-drift -- --update (after reviewing React impact)",
    files: Object.fromEntries(
      Object.entries(hashes.files).map(([id, meta]) => [
        id,
        { sha256: meta.sha256, bytes: meta.bytes, rel: meta.rel },
      ]),
    ),
  };
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function main() {
  const hashes = buildHashes();
  const contracts = checkContracts();
  const contractFails = contracts.filter((c) => !c.ok);

  if (hashes.missing.length) {
    const msg = hashes.missing.map((m) => m.rel).join(", ");
    fail(`Missing watched files: ${msg}`);
  }

  if (DO_UPDATE) {
    if (contractFails.length) {
      fail(
        "Cannot update baseline while contracts fail:\n" +
          contractFails.map((c) => `  - ${c.id}: ${c.detail}`).join("\n"),
      );
    }
    const payload = writeBaseline(hashes);
    report({
      ok: true,
      updated: true,
      baselinePath: path.relative(REPO, BASELINE_PATH),
      fileCount: Object.keys(payload.files).length,
      contracts,
    });
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    fail(
      `No baseline at ${path.relative(REPO, BASELINE_PATH)}. Run:\n  npm run check:legacy-drift -- --update`,
    );
  }

  /** @type {{ id: string, rel: string, category: string, note?: string }[]} */
  const changed = [];
  for (const entry of WATCHED) {
    const cur = hashes.files[entry.id];
    const prev = baseline.files?.[entry.id];
    if (!prev) {
      changed.push({ ...entry, note: "new watch entry — accept with --update" });
      continue;
    }
    if (prev.sha256 !== cur.sha256) {
      changed.push(entry);
    }
  }

  const staleBaseline = Object.keys(baseline.files || {}).filter(
    (id) => !hashes.files[id],
  );

  const ok = changed.length === 0 && contractFails.length === 0;
  report({
    ok,
    updated: false,
    changed,
    staleBaseline,
    contracts,
    hints: ok
      ? []
      : [
          ...changed.map(
            (c) =>
              `FILE ${c.id} (${c.rel}) [${c.category}]${c.note ? " — " + c.note : ""}`,
          ),
          ...contractFails.map((c) => `CONTRACT ${c.id}: ${c.detail}`),
          "After reviewing React impact: npm run check:legacy-drift -- --update",
          "Migrated surfaces to spot-check: #/topics, #/topic/:id/theory, shell XP, sandbox, sky",
        ],
  });

  if (!ok) process.exit(1);
}

function report(data) {
  if (AS_JSON) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (data.updated) {
    console.log(
      `legacy-drift: baseline updated (${data.fileCount} files) → ${data.baselinePath}`,
    );
    return;
  }
  if (data.ok) {
    console.log(
      `legacy-drift: OK (${WATCHED.length} files, ${data.contracts.length} contracts)`,
    );
    return;
  }
  console.error("legacy-drift: CHANGES DETECTED\n");
  for (const h of data.hints) console.error("  • " + h);
  console.error("");
}

function fail(message) {
  if (AS_JSON) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error("legacy-drift: " + message);
  }
  process.exit(1);
}

main();
