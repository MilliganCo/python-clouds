import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SafeMarkdown } from "../../components/SafeMarkdown/SafeMarkdown";
import { apiGet, apiPost, ApiError } from "../../services/api";
import { showToast } from "../../services/toast";

type RiddleMsg = { role: "user" | "ai"; text: string; thinking?: boolean };

type Status = {
  history: Array<{ role: string; text: string }>;
  left: number;
  asked: number;
  limit: number;
  finished: boolean;
};

function parseStatus(value: unknown): Status {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid riddle status");
  }
  const v = value as Record<string, unknown>;
  const history = Array.isArray(v.history)
    ? (v.history as Array<{ role: string; text: string }>)
    : [];
  return {
    history,
    left: typeof v.left === "number" ? v.left : 0,
    asked: typeof v.asked === "number" ? v.asked : 0,
    limit: typeof v.limit === "number" ? v.limit : 5,
    finished: !!v.finished,
  };
}

function parseTurn(value: unknown): {
  reply?: string;
  left: number;
  limit: number;
  finished: boolean;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid riddle turn");
  }
  const v = value as Record<string, unknown>;
  return {
    reply: typeof v.reply === "string" ? v.reply : undefined,
    left: typeof v.left === "number" ? v.left : 0,
    limit: typeof v.limit === "number" ? v.limit : 5,
    finished: !!v.finished,
  };
}

/**
 * Legacy `#/game/riddle` — AI chat riddles, no drops.
 */
export function RiddlePage() {
  const [messages, setMessages] = useState<RiddleMsg[]>([]);
  const [input, setInput] = useState("");
  const [leftLabel, setLeftLabel] = useState("Загрузка…");
  const [finished, setFinished] = useState(false);
  const [chatOn, setChatOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  function setLeft(left: number, asked: number, limit: number, done: boolean) {
    setLeftLabel(
      done || left <= 0
        ? `Раунд на сегодня закрыт (${limit}/${limit}). Завтра снова.`
        : `Загадано: ${asked} · осталось слотов: ${left}`,
    );
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await apiGet("/api/riddle/status", parseStatus);
        if (cancelled) return;
        setMessages(
          st.history.map((m) => ({
            role: m.role === "user" ? "user" : "ai",
            text: m.text,
          })),
        );
        setFinished(st.finished);
        setLeft(st.left, st.asked, st.limit, st.finished);
        if (st.history.length && !st.finished) setChatOn(true);
        else setChatOn(false);
      } catch {
        if (!cancelled) setLeftLabel("Не удалось загрузить статус");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function turn(message: string) {
    setBusy(true);
    setChatOn(false);
    if (message) {
      setMessages((prev) => [...prev, { role: "user", text: message }]);
    }
    setMessages((prev) => [
      ...prev,
      { role: "ai", text: "", thinking: true },
    ]);
    try {
      const r = await apiPost(
        "/api/riddle/turn",
        { message: message || "" },
        parseTurn,
      );
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.thinking) {
          next[next.length - 1] = {
            role: "ai",
            text: r.reply || "",
          };
        } else if (r.reply) {
          next.push({ role: "ai", text: r.reply });
        }
        return next;
      });
      setFinished(r.finished);
      setLeft(r.left, (r.limit || 5) - (r.left || 0), r.limit || 5, r.finished);
      setChatOn(!r.finished);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка";
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.thinking) {
          next[next.length - 1] = { role: "ai", text: "Ошибка: " + msg };
        }
        return next;
      });
      if (msg.includes("Формат раунда обновлён")) {
        setFinished(false);
        setChatOn(false);
      } else {
        setChatOn(!finished);
      }
      if (err instanceof ApiError) showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task-page game-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/game">Мини-игры</Link> /
          Загадки
        </div>
      </div>
      <div className="pane game-pane riddle-pane">
        <div className="riddle-head">
          <h2 className="game-title">[AI?] Загадки</h2>
          <p className="game-sub">
            Переписка с ИИ: до 5 загадок в день, без капель
          </p>
          <p className="riddle-left" id="riddleLeft">
            {leftLabel}
          </p>
        </div>
        <div className="riddle-log" id="riddleLog" ref={logRef} aria-live="polite">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`riddle-msg ${m.role}${m.thinking ? " thinking" : ""}`}
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
          className="riddle-form"
          id="riddleForm"
          onSubmit={(e) => {
            e.preventDefault();
            const msg = input.trim();
            if (!msg || finished || busy) return;
            setInput("");
            void turn(msg);
          }}
        >
          <input
            id="riddleInput"
            type="text"
            maxLength={200}
            autoComplete="off"
            placeholder="Ответ: A–D или короткая фраза"
            disabled={!chatOn || busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            className="btn dark"
            id="riddleSend"
            type="submit"
            disabled={!chatOn || busy}
          >
            Отправить
          </button>
        </form>
        <div className="run-row riddle-actions">
          <button
            className="btn"
            type="button"
            id="riddleStart"
            disabled={chatOn || finished || busy}
            onClick={() => void turn("")}
          >
            Начать раунд
          </button>
          <Link className="btn" to="/game">
            К играм
          </Link>
        </div>
      </div>
    </div>
  );
}
