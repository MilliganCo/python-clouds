import { useCallback, useEffect, useState } from "react";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import { HINT_BY_TYPE, HINT_PRICES } from "../../content/stageLessons";
import { apiGet, apiPost, ApiError } from "../../services/api";
import { sanitizeCourseHtml } from "../../services/legacyContent";
import { ContractError } from "../../services/parse";
import { showToast } from "../../services/toast";
import { emitDrops } from "../../services/walletEvents";
import type { TaskPageModel } from "../../types/content";
import { inlineCourseText } from "./inlineCourseText";

type HintItem = {
  level: number;
  title: string;
  bodyHtml: string;
  price: number;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseHintsStatus(value: unknown): {
  unlocked: number[];
  prices: Record<number, number>;
} {
  if (!isObject(value) || !Array.isArray(value.unlocked)) {
    throw new ContractError("Invalid GET /api/hints");
  }
  const unlocked = value.unlocked.filter(
    (n): n is number => typeof n === "number",
  );
  const prices: Record<number, number> = { ...HINT_PRICES };
  if (isObject(value.prices)) {
    for (const [k, v] of Object.entries(value.prices)) {
      if (typeof v === "number") prices[Number(k)] = v;
    }
  }
  return { unlocked, prices };
}

function parseUnlock(value: unknown): { ok: true; drops: number } {
  if (!isObject(value) || value.ok !== true || typeof value.drops !== "number") {
    throw new ContractError("Invalid POST /api/hints/unlock");
  }
  return { ok: true, drops: value.drops };
}

function buildItems(
  task: TaskPageModel,
  prices: Record<number, number>,
): HintItem[] {
  const direction =
    task.hint ||
    HINT_BY_TYPE[task.type] ||
    "Разберите условие на части.";
  return [
    {
      level: 1,
      title: "Подсказка 1 · направление",
      bodyHtml: sanitizeCourseHtml(inlineCourseText(direction)),
      price: 0,
    },
    {
      level: 2,
      title: "Подсказка 2 · объяснение",
      bodyHtml: sanitizeCourseHtml(inlineCourseText(task.explanation || "")),
      price: prices[2] ?? 5,
    },
    {
      level: 3,
      title: "Подсказка 3 · полный ответ",
      bodyHtml: `<pre>${escapeHtml(task.answer || "")}</pre>`,
      price: prices[3] ?? 15,
    },
  ];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Props = { task: TaskPageModel };

/**
 * Legacy hints pane — level 1 free; 2/3 unlock via /api/hints.
 */
export function HintsPane({ task }: Props) {
  const [unlocked, setUnlocked] = useState<number[]>([]);
  const [prices, setPrices] = useState(HINT_PRICES);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [busyLevel, setBusyLevel] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await apiGet(
        `/api/hints?task_id=${encodeURIComponent(task.id)}`,
        parseHintsStatus,
      );
      setUnlocked(d.unlocked);
      setPrices(d.prices);
    } catch {
      /* keep defaults */
    }
  }, [task.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const items = buildItems(task, prices);

  async function unlock(level: number) {
    setBusyLevel(level);
    try {
      const r = await apiPost(
        "/api/hints/unlock",
        { task_id: task.id, level },
        parseUnlock,
      );
      emitDrops(r.drops);
      await reload();
      setOpenLevel(level);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Ошибка";
      showToast(msg);
    } finally {
      setBusyLevel(null);
    }
  }

  return (
    <div className="pane hints-pane">
      <h3>Подсказки</h3>
      <div className="hints" id="hints">
        {items.map((h) => {
          const isOpen = h.price === 0 || unlocked.includes(h.level);
          const expanded = openLevel === h.level || (h.level === 1 && openLevel === null);
          if (isOpen) {
            return (
              <div
                key={h.level}
                className={`hint${expanded || openLevel === h.level ? " open" : ""}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenLevel((cur) => (cur === h.level ? null : h.level))
                  }
                >
                  {h.title}
                </button>
                <div className="hint-body">
                  <TrustedCourseContent html={h.bodyHtml} as="div" />
                </div>
              </div>
            );
          }
          return (
            <div key={h.level} className="hint locked">
              <button
                type="button"
                className="hint-unlock"
                disabled={busyLevel === h.level}
                onClick={() => void unlock(h.level)}
              >
                {h.title}{" "}
                <span className="hint-price">
                  <span className="drop-dot small" />
                  {h.price}
                </span>
              </button>
              <div className="hint-body">
                <TrustedCourseContent html={h.bodyHtml} as="div" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
