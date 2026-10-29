import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  LiveTerminal,
  type LiveTerminalHandle,
} from "../../components/LiveTerminal/LiveTerminal";
import {
  fetchShowcaseCard,
  showcaseRunCode,
  voteShowcaseCard,
  type ShowcaseCard,
} from "../../services/showcase";

const VOTES = [-3, -2, -1, 1, 2, 3];

function filesSummary(card: ShowcaseCard): string {
  const n = card.file_count || 1;
  return `${n} ${n === 1 ? "файл" : "файла"}`;
}

/**
 * Legacy `#/showcase/:id` — code, run, votes.
 */
export function ShowcaseCardPage() {
  const { id = "" } = useParams<{ id: string }>();
  const cardId = Number(id);
  const [card, setCard] = useState<ShowcaseCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [running, setRunning] = useState(false);
  const termRef = useRef<LiveTerminalHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError(null);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      setError("Карточка не найдена");
      return;
    }
    (async () => {
      try {
        const data = await fetchShowcaseCard(cardId);
        if (!cancelled) setCard(data.card);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  async function onVote(value: number) {
    if (!card) return;
    setVoting(true);
    try {
      const res = await voteShowcaseCard(card.id, value);
      setCard(res.card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setVoting(false);
    }
  }

  async function onRun() {
    if (!card) return;
    setRunning(true);
    try {
      await termRef.current?.run(showcaseRunCode(card.files));
    } finally {
      setRunning(false);
    }
  }

  if (error && !card) {
    return (
      <div className="task-page project-page">
        <div className="empty">
          <h2>Не удалось открыть карточку</h2>
          <p>{error}</p>
          <Link className="btn dark" to="/showcase">
            К списку
          </Link>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="task-page project-page">
        <div className="empty">Открываю карточку...</div>
      </div>
    );
  }

  const files = card.files || [];

  return (
    <div className="task-page project-page showcase-page showcase-detail-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/showcase">Доска работ</Link> /{" "}
          {card.title}
        </div>
        <Link className="btn" to="/showcase">
          К списку
        </Link>
      </div>
      <article className="pane showcase-detail">
        <div className="showcase-detail-hero">
          <div
            className={`showcase-cover showcase-cover-${card.cover || "aurora"} showcase-cover-lg`}
          >
            <span>{card.title.slice(0, 1).toUpperCase()}</span>
          </div>
          <div className="showcase-detail-head">
            <span className="project-kicker">{card.owner_name}</span>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <div className="showcase-meta">
              <span className="cloud-score">{card.score} облачков</span>
              <span>{filesSummary(card)}</span>
              {card.is_multi_file ? <span>multi-file</span> : null}
            </div>
          </div>
        </div>
        <div className="showcase-detail-body">
          <section className="showcase-files">
            <h3>Код</h3>
            {files.map((f) => (
              <div key={f.name} className="showcase-file-block">
                <div className="showcase-file-name">{f.name}</div>
                <pre className="showcase-file-code">{f.code || ""}</pre>
              </div>
            ))}
          </section>
          <section className="showcase-detail-panel">
            <h3>Запуск и голоса</h3>
            <div
              className="showcase-votes"
              aria-label="Голосование от минус трёх до плюс трёх"
            >
              {VOTES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`showcase-vote${card.my_vote === value ? " active" : ""}`}
                  disabled={voting}
                  onClick={() => void onVote(value)}
                >
                  {value > 0 ? `+${value}` : value}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn dark wide showcase-run"
              disabled={running}
              onClick={() => void onRun()}
            >
              Запустить
            </button>
            <div className="terminal-body showcase-output">
              <LiveTerminal runRef={termRef} />
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
