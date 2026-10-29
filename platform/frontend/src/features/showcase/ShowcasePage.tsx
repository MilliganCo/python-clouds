import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchShowcaseBoard,
  type ShowcaseBoard,
  type ShowcaseCard,
} from "../../services/showcase";

function filesSummary(card: ShowcaseCard): string {
  const n = card.file_count || 1;
  return `${n} ${n === 1 ? "файл" : "файла"}`;
}

function ListCard({ card }: { card: ShowcaseCard }) {
  return (
    <article className="pane showcase-list-card">
      <Link className="showcase-list-link" to={`/showcase/${card.id}`}>
        <div className={`showcase-cover showcase-cover-${card.cover || "aurora"}`}>
          <span>{card.title.slice(0, 1).toUpperCase()}</span>
        </div>
        <div className="showcase-card-body">
          <div className="showcase-card-head">
            <div>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </div>
            <span className="cloud-score">{card.score} облачков</span>
          </div>
          <div className="showcase-meta">
            <span>{card.owner_name}</span>
            <span>{filesSummary(card)}</span>
            {card.is_multi_file ? <span>multi-file</span> : null}
          </div>
          <span className="showcase-open-hint">Открыть карточку →</span>
        </div>
      </Link>
    </article>
  );
}

/**
 * Legacy `#/showcase` — feed + leaderboard.
 */
export function ShowcasePage() {
  const [board, setBoard] = useState<ShowcaseBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchShowcaseBoard();
        if (!cancelled) setBoard(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="task-page project-page">
        <div className="empty">
          <h2>Не удалось открыть доску</h2>
          <p>{error}</p>
          <Link className="btn dark" to="/">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="task-page project-page">
        <div className="empty">Загружаю доску проектов...</div>
      </div>
    );
  }

  const cards = board.cards;
  const leaders = board.leaderboard.slice(0, 6);

  return (
    <div className="task-page project-page showcase-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / Доска работ
        </div>
        <div className="showcase-nav-actions">
          <Link className="btn" to="/projects">
            К квестам
          </Link>
          <Link className="btn dark" to="/showcase/new">
            Создать проект
          </Link>
        </div>
      </div>
      <section className="pane project-hero showcase-hero">
        <span className="project-kicker">Общая витрина</span>
        <h2>Программы учеников</h2>
        <p>
          Смотрите чужой код, запускайте в карточке и голосуйте облачками.
          Создание своей программы — на отдельной странице.
        </p>
      </section>
      <div className="showcase-layout">
        <main className="showcase-feed">
          {cards.length ? (
            cards.map((c) => <ListCard key={c.id} card={c} />)
          ) : (
            <div className="pane empty">
              <p>Пока нет карточек. Станьте первым автором.</p>
              <Link className="btn dark" to="/showcase/new">
                Создать проект
              </Link>
            </div>
          )}
        </main>
        <aside className="showcase-side">
          <section className="pane">
            <h3>Лидерборд</h3>
            <div className="leader-list">
              {leaders.length ? (
                leaders.map((card, i) => (
                  <Link
                    key={card.id}
                    className="leader-row"
                    to={`/showcase/${card.id}`}
                  >
                    <span>{i + 1}</span>
                    <b>{card.title}</b>
                    <small>{card.score}</small>
                  </Link>
                ))
              ) : (
                <p className="stat-note">Пока пусто</p>
              )}
            </div>
          </section>
          <section className="pane showcase-cta">
            <h3>Своя программа</h3>
            <p className="stat-note">
              Опубликуйте код на доске: название, описание, оформление и файлы —
              на отдельной странице.
            </p>
            <Link className="btn dark wide" to="/showcase/new">
              Создать проект
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
