import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation } from "react-router-dom";
import { SafeMarkdown } from "../../components/SafeMarkdown/SafeMarkdown";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import {
  contentRepository,
  type ContentRepository,
} from "../../content/ContentRepository";
import {
  askAi,
  fetchAiHistory,
  type AiAskContext,
  type AiHistoryMessage,
} from "../../services/aiMentor";
import { apiGet } from "../../services/api";
import { sanitizeCourseHtml } from "../../services/legacyContent";
import { parseFact, parseProgress } from "../../services/parse";
import { emitDrops } from "../../services/walletEvents";
import { inlineCourseText } from "../task/inlineCourseText";

type ChatMsg = {
  role: "user" | "ai";
  text: string;
  thinking?: boolean;
};

type Props = {
  repository?: ContentRepository;
};

function taskIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/task\/([^/]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

const FACT_GREETED_PREFIX = "pycloud:ai-fact:";

async function buildContext(
  repository: ContentRepository,
): Promise<AiAskContext> {
  const progress = await apiGet("/api/progress", parseProgress).catch(() => ({
    solved: [] as string[],
  }));
  const catalog = repository.getCatalogTopics();
  const total = catalog.reduce((n, t) => n + t.tasks.length, 0);
  const byTopic = new Map<string, number>();
  const solvedSet = new Set(progress.solved);
  for (const topic of catalog) {
    let n = 0;
    for (const task of topic.tasks) {
      if (solvedSet.has(task.id)) n += 1;
    }
    if (n) byTopic.set(topic.title, n);
  }
  return {
    solved_count: progress.solved.length,
    total,
    topics_progress: [...byTopic.entries()]
      .map(([title, n]) => `${title}: ${n}`)
      .slice(0, 20),
  };
}

/**
 * Legacy AI FAB + drawer on `#/task/:id` (replaces sandbox FAB there).
 */
export function AiMentorShell({
  repository = contentRepository,
}: Props) {
  const location = useLocation();
  const taskId = taskIdFromPath(location.pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState("");
  const [engineBadge, setEngineBadge] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await repository.ensureLoaded();
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const lookup = ready && taskId ? repository.getTask(taskId) : null;
  const task = lookup?.status === "ok" ? lookup.task : null;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
    setMessages([]);
    setEngineBadge("");
    setQuestion("");
  }, [taskId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  async function openDrawer() {
    if (!task) return;
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());

    const past = await fetchAiHistory(task.id).catch(
      (): AiHistoryMessage[] => [],
    );
    if (past.length) {
      setMessages(
        past.map((m) => ({
          role: m.role === "user" ? "user" : "ai",
          text: m.text,
        })),
      );
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    const greetedKey = FACT_GREETED_PREFIX + day;
    let greeted = false;
    try {
      greeted = localStorage.getItem(greetedKey) === "1";
    } catch {
      /* ignore */
    }

    if (!greeted) {
      let fact = "";
      try {
        const data = await apiGet("/api/fact", parseFact);
        fact = data.facts[0] ?? "";
      } catch {
        fact = "";
      }
      const greet = fact
        ? `Привет! Начнём день с короткого факта про Python:\n\n**Факт дня.** ${fact}\n\nСпросите что угодно по заданию ${task.id} — подскажу направление или разберу по шагам.`
        : `Спросите что угодно по заданию ${task.id}: подскажу направление или разберу по шагам.`;
      setMessages([{ role: "ai", text: greet }]);
      try {
        localStorage.setItem(greetedKey, "1");
      } catch {
        /* ignore */
      }
    } else {
      setMessages([
        {
          role: "ai",
          text: `Спросите что угодно по заданию ${task.id}: подскажу направление или разберу по шагам.`,
        },
      ]);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || !task || busy) return;
    setQuestion("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "ai", text: "", thinking: true },
    ]);
    try {
      const context = await buildContext(repository);
      const r = await askAi(
        {
          id: task.id,
          type: task.type,
          prompt: task.prompt,
          answer: task.answer,
        },
        q,
        context,
      );
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.thinking) {
          next[next.length - 1] = { role: "ai", text: r.reply };
        } else {
          next.push({ role: "ai", text: r.reply });
        }
        return next;
      });
      const tariff =
        r.cost > 0
          ? ` · −${r.cost} капель`
          : typeof r.free_left === "number"
            ? ` · бесплатных сегодня: ${r.free_left}`
            : "";
      setEngineBadge(
        (r.engine === "opencode" ? "ИИ онлайн" : "офлайн-подсказки") + tariff,
      );
      if (typeof r.drops === "number") emitDrops(r.drops);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка сервиса";
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.thinking) {
          next[next.length - 1] = { role: "ai", text: "Ошибка: " + msg };
        } else {
          next.push({ role: "ai", text: "Ошибка: " + msg });
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  if (!task) return null;

  const promptHtml = sanitizeCourseHtml(inlineCourseText(task.prompt));

  return (
    <>
      <button
        type="button"
        className="sandbox-fab is-mentor"
        aria-label="Открыть наставника"
        onClick={() => void openDrawer()}
      >
        <span className="fab-icon">✎</span> Наставник
      </button>

      <aside
        className={`ai-drawer${open ? " open" : ""}`}
        id="aiDrawer"
        aria-hidden={open ? "false" : "true"}
      >
        <div className="ai-head">
          <div>
            <strong id="aiTaskId">Помощник · задание {task.id}</strong>
            <span className="ai-engine" id="aiEngine">
              {engineBadge}
            </span>
          </div>
          <button
            type="button"
            className="link-btn"
            id="aiClose"
            aria-label="Закрыть"
            onClick={close}
          >
            <span className="nf nf-close" aria-hidden="true" />
          </button>
        </div>
        <div className="ai-context" id="aiContext">
          <span className="ctx-id">{task.id}</span> · {task.type}
          <br />
          <TrustedCourseContent html={promptHtml} />
        </div>
        <div className="ai-log" id="aiLog" ref={logRef}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`msg ${m.role}${m.thinking ? " thinking" : ""}`}
            >
              {m.thinking ? (
                <>
                  <span className="thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>Наставник думает…</span>
                </>
              ) : m.role === "ai" ? (
                <SafeMarkdown source={m.text} />
              ) : (
                m.text
              )}
            </div>
          ))}
        </div>
        <form
          className="ai-input"
          id="aiForm"
          onSubmit={(e) => void onSubmit(e)}
        >
          <input
            id="aiQuestion"
            ref={inputRef}
            type="text"
            placeholder="Спросите про это задание"
            autoComplete="off"
            aria-label="Вопрос"
            value={question}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn dark" disabled={busy}>
            Спросить
          </button>
        </form>
      </aside>
      <div
        className="ai-scrim"
        id="aiScrim"
        hidden={!open}
        onClick={close}
        aria-hidden="true"
      />
    </>
  );
}
