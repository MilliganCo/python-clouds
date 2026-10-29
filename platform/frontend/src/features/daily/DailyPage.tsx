import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import { apiGet, apiPost } from "../../services/api";
import { sanitizeCourseHtml } from "../../services/legacyContent";
import {
  parseDailyAi,
  parseDailyAiSolve,
  type DailyAiPayload,
  type DailyAiTask,
} from "../../services/parse";
import { pythonRunner } from "../../services/pythonRunner";
import { emitDrops } from "../../services/walletEvents";
import { flyDrops } from "../../services/flyDrops";
import { inlineCourseText } from "../task/inlineCourseText";

const DIFFS = ["intermediate", "advanced", "expert"] as const;
type Diff = (typeof DIFFS)[number];

const DAILY_RU: Record<Diff, string> = {
  intermediate: "средний",
  advanced: "продвинутый",
  expert: "экспертный",
};

function isDiff(s: string | undefined): s is Diff {
  return !!s && (DIFFS as readonly string[]).includes(s);
}

function draftKey(day: string, diff: string): string {
  return `pycloud:daily:${day}:${diff}`;
}

type Verdict =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "fail"; message: string; detail?: string };

type Screen =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "pending" }
  | { status: "bad_diff" }
  | {
      status: "ready";
      payload: DailyAiPayload;
      task: DailyAiTask;
      diff: Diff;
    };

/**
 * Legacy `#/daily/:diff` — AI daily challenge, client-side tests + server award.
 */
export function DailyPage() {
  const { diff: rawDiff } = useParams<{ diff: string }>();
  const [screen, setScreen] = useState<Screen>({ status: "loading" });
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [outputErr, setOutputErr] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });
  const [solved, setSolved] = useState(false);

  const load = useCallback(async (forcePendingRetry = false) => {
    if (!isDiff(rawDiff)) {
      setScreen({ status: "bad_diff" });
      return;
    }
    if (!forcePendingRetry) setScreen({ status: "loading" });
    try {
      const payload = await apiGet("/api/daily-ai", parseDailyAi);
      const task = payload.tasks[rawDiff];
      if (!task) {
        setScreen({ status: "pending" });
        return;
      }
      const starter = task.starter || "# Решение\n";
      const key = draftKey(payload.day, rawDiff);
      let draft = starter;
      try {
        draft = localStorage.getItem(key) ?? starter;
      } catch {
        /* ignore */
      }
      setCode(draft);
      setSolved(payload.solved.includes(rawDiff));
      setVerdict({ kind: "idle" });
      setOutput("");
      setScreen({ status: "ready", payload, task, diff: rawDiff });
    } catch (err) {
      setScreen({
        status: "error",
        message: err instanceof Error ? err.message : "Ошибка загрузки",
      });
    }
  }, [rawDiff]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while mentor is still generating this difficulty.
  useEffect(() => {
    if (screen.status !== "pending" || !isDiff(rawDiff)) return;
    const id = window.setTimeout(() => {
      void load(true);
    }, 15000);
    return () => window.clearTimeout(id);
  }, [screen.status, rawDiff, load]);

  useEffect(() => {
    if (screen.status === "ready") void pythonRunner.warmup();
  }, [screen]);

  function persist(next: string) {
    setCode(next);
    if (screen.status !== "ready") return;
    try {
      localStorage.setItem(draftKey(screen.payload.day, screen.diff), next);
    } catch {
      /* ignore */
    }
  }

  function onEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = code.slice(0, start) + "    " + code.slice(end);
      persist(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
  }

  function onReset() {
    if (screen.status !== "ready") return;
    const starter = screen.task.starter || "# Решение\n";
    try {
      localStorage.removeItem(draftKey(screen.payload.day, screen.diff));
    } catch {
      /* ignore */
    }
    setCode(starter);
    setOutput("");
    setOutputErr(false);
    setVerdict({ kind: "idle" });
    setRunStatus("Код восстановлен");
  }

  async function onRun() {
    setBusy(true);
    setOutput("");
    setOutputErr(false);
    try {
      const r = await pythonRunner.run(code, {
        onStatus: (s) => setRunStatus(s || ""),
      });
      if (r.ok) {
        setOutput(r.stdout || "(нет вывода)");
        setOutputErr(false);
      } else if (r.error.kind === "python") {
        setOutput((r.error.stdout || "") + r.error.traceback);
        setOutputErr(true);
      } else {
        setOutput(
          "message" in r.error
            ? r.error.message
            : r.error.kind === "timeout"
              ? "Превышено время выполнения."
              : "Ошибка запуска",
        );
        setOutputErr(true);
      }
    } finally {
      setRunStatus("");
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (screen.status !== "ready") return;
    const { task, diff, payload } = screen;
    const tests = typeof task.tests === "string" ? task.tests : "";
    setBusy(true);
    setVerdict({ kind: "idle" });
    setOutput("");
    setOutputErr(false);
    try {
      const r = await pythonRunner.run(code + "\n\n" + tests, {
        onStatus: (s) => setRunStatus(s || ""),
      });
      if (!r.ok) {
        const detail =
          r.error.kind === "python"
            ? r.error.traceback
            : "message" in r.error
              ? r.error.message
              : "Ошибка";
        setVerdict({
          kind: "fail",
          message: "Тесты не пройдены.",
          detail,
        });
        return;
      }
      const out = (r.stdout || "").trim();
      if (!out.endsWith("OK")) {
        setVerdict({
          kind: "fail",
          message: "Тесты не пройдены.",
          detail: task.func_name
            ? `Проверьте имя функции: нужна ${task.func_name}.`
            : undefined,
        });
        return;
      }

      if (solved || payload.solved.includes(diff)) {
        setVerdict({
          kind: "ok",
          message: "Принято! Награда за сегодня уже получена.",
        });
        setSolved(true);
        return;
      }

      try {
        const res = await apiPost(
          "/api/daily-ai/solve",
          { difficulty: diff },
          parseDailyAiSolve,
        );
        emitDrops(res.drops);
        if (res.awarded > 0) flyDrops(res.awarded);
        setSolved(true);
        setVerdict({
          kind: "ok",
          message:
            res.awarded > 0
              ? `Принято! +${res.awarded} капель`
              : "Принято!",
        });
      } catch {
        setSolved(true);
        setVerdict({ kind: "ok", message: "Принято!" });
      }
    } finally {
      setRunStatus("");
      setBusy(false);
    }
  }

  if (screen.status === "loading") {
    return (
      <div className="task-page">
        <div className="empty">Загружаю задание дня…</div>
      </div>
    );
  }

  if (screen.status === "bad_diff") {
    return (
      <div className="task-page">
        <div className="empty">
          Неизвестная сложность.{" "}
          <Link to="/">На главную</Link>
        </div>
      </div>
    );
  }

  if (screen.status === "error") {
    return (
      <div className="task-page">
        <div className="empty">{screen.message}</div>
      </div>
    );
  }

  if (screen.status === "pending") {
    return (
      <div className="task-page">
        <div className="empty">
          ✎ Наставник ещё придумывает задание этой сложности — вернитесь через
          минуту.
        </div>
      </div>
    );
  }

  const { task, diff, payload } = screen;
  const drops = payload.drops[diff] ?? 0;
  const promptHtml = sanitizeCourseHtml(
    inlineCourseText(task.prompt || ""),
  );

  return (
    <div className="task-page daily-ai-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / Задание дня
        </div>
        <span className={`level-badge lv-${diff}`}>{DAILY_RU[diff]}</span>
      </div>

      <div className="pane flow-task daily-ai-challenge">
        <div className="daily-ai-hero">
          <span className="daily-ai-kicker">челлендж дня · без подсказок</span>
          <div className="task-title-row">
            <h2>{task.title}</h2>
            <span className="chip">+{drops} капель</span>
            {solved ? (
              <span className="chip solved-flag" id="dailySolvedFlag">
                решено
              </span>
            ) : null}
          </div>
          <p className="prompt">
            <TrustedCourseContent html={promptHtml} as="span" />
          </p>
        </div>

        <div className="terminal-glass editable">
          <div className="terminal-label-bar">
            <span className="terminal-title">solution.py</span>
            <span className="terminal-actions">
              <button
                type="button"
                className="term-reset-btn"
                title="Сбросить код к исходному"
                aria-label="Сбросить код к исходному"
                id="dailyResetBtn"
                onClick={onReset}
              >
                <span className="nf nf-restore" aria-hidden="true" />
              </button>
            </span>
          </div>
          <textarea
            className="editor"
            id="dailyEditor"
            spellCheck={false}
            value={code}
            onChange={(e) => persist(e.target.value)}
            onKeyDown={onEditorKeyDown}
          />
        </div>

        <div className="run-row">
          <button
            type="button"
            className="btn"
            id="dailyRunBtn"
            disabled={busy}
            onClick={() => void onRun()}
          >
            Запустить
          </button>
          <button
            type="button"
            className="btn dark"
            id="dailySubmitBtn"
            disabled={busy}
            onClick={() => void onSubmit()}
          >
            Отправить на проверку
          </button>
          <span className="run-status" id="dailyStatus">
            {runStatus}
          </span>
        </div>

        <div className="task-output-wrap">
          <div className="terminal-glass editable">
            <div className="terminal-label-bar">
              <span className="terminal-title">вывод</span>
            </div>
            <pre
              className={"terminal-body output" + (outputErr ? " err" : "")}
              id="dailyOutput"
            >
              {output}
            </pre>
          </div>
        </div>

        <div
          className={
            "verdict" +
            (verdict.kind !== "idle" ? " show" : "") +
            (verdict.kind === "ok" ? " ok" : "") +
            (verdict.kind === "fail" ? " fail" : "")
          }
          id="dailyVerdict"
        >
          {verdict.kind === "ok" ? (
            <>
              <strong>{verdict.message}</strong>
              {" · "}
              <Link to="/">на главную</Link>
            </>
          ) : null}
          {verdict.kind === "fail" ? (
            <>
              <strong>{verdict.message}</strong>
              {verdict.detail ? <pre>{verdict.detail}</pre> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
