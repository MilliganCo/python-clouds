import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import {
  catalogStageTitle,
  contentRepository,
  firstUnsolvedTask,
  type ContentRepository,
} from "../../content/ContentRepository";
import {
  LEVEL_ORDER,
  LEVEL_SUB,
  LEVEL_TITLE,
  topicSymbol,
  type CatalogLevel,
} from "../../content/topicCatalogMeta";
import { topicInsight } from "../../content/topicInsights";
import { apiGet } from "../../services/api";
import { parseProgress } from "../../services/parse";
import { pointsFor } from "../../services/rankProgress";
import type { CatalogTopicModel } from "../../types/content";
import { SiteFooter } from "../shell/SiteFooter";

type LevelFilter = "all" | CatalogLevel;

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      topics: CatalogTopicModel[];
      solved: ReadonlySet<string>;
    };

type Props = {
  repository?: ContentRepository;
};

const LEVEL_TABS: Array<{ level: LevelFilter; label: string }> = [
  { level: "all", label: "Все" },
  { level: "beginner", label: "Начальный" },
  { level: "intermediate", label: "Средний" },
  { level: "advanced", label: "Продвинутый" },
  { level: "expert", label: "Экспертный" },
];

function matchesQuery(topic: CatalogTopicModel, q: string): boolean {
  if (!q) return true;
  if (topic.title.toLowerCase().includes(q)) return true;
  return topic.tasks.some(
    (t) =>
      t.prompt.toLowerCase().includes(q) ||
      (t.code || "").toLowerCase().includes(q),
  );
}

export function TopicsCatalogPage({
  repository = contentRepository,
}: Props) {
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" });
  const [level, setLevel] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [openTopics, setOpenTopics] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setScreen({ status: "loading" });

    (async () => {
      try {
        await repository.ensureLoaded();
        const progress = await apiGet("/api/progress", parseProgress);
        if (cancelled) return;
        setScreen({
          status: "ready",
          topics: repository.getCatalogTopics(),
          solved: new Set(progress.solved),
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Ошибка загрузки";
        setScreen({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repository]);

  const visible = useMemo(() => {
    if (screen.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    return screen.topics.filter((topic) => {
      if (level !== "all" && topic.level !== level) return false;
      return matchesQuery(topic, q);
    });
  }, [screen, level, query]);

  const totals = useMemo(() => {
    if (screen.status !== "ready") {
      return { solvedTasks: 0, totalTasks: 0, doneTopics: 0, totalTopics: 0 };
    }
    const { topics, solved } = screen;
    let totalTasks = 0;
    let solvedTasks = 0;
    let doneTopics = 0;
    for (const topic of topics) {
      totalTasks += topic.tasks.length;
      const done = topic.tasks.filter((t) => solved.has(t.id)).length;
      solvedTasks += done;
      if (done === topic.tasks.length && topic.tasks.length > 0) doneTopics += 1;
    }
    return {
      solvedTasks,
      totalTasks,
      doneTopics,
      totalTopics: topics.length,
    };
  }, [screen]);

  function toggleTopic(topicId: number) {
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  function onTopicHeadClick(e: MouseEvent, topicId: number) {
    if ((e.target as HTMLElement).closest(".topic-go")) return;
    toggleTopic(topicId);
  }

  if (screen.status === "loading") {
    return (
      <div className="topics-catalog-page">
        <p>Загрузка…</p>
      </div>
    );
  }

  if (screen.status === "error") {
    return (
      <div className="topics-catalog-page">
        <div className="pane">
          <h2>Не удалось загрузить каталог</h2>
          <p>{screen.message}</p>
          <Link className="btn" to="/">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  const { solved } = screen;
  const searchActive = query.trim().length > 0;

  return (
    <div className="topics-catalog-page">
      <nav className="controls" id="topicsControls">
        <div className="tabs" id="levelTabs" role="tablist">
          {LEVEL_TABS.map((tab) => (
            <button
              key={tab.level}
              type="button"
              className={`tab${level === tab.level ? " active" : ""}`}
              data-level={tab.level}
              role="tab"
              aria-selected={level === tab.level}
              onClick={() => setLevel(tab.level)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          id="search"
          type="search"
          className="search"
          placeholder="Поиск по темам и заданиям"
          aria-label="Поиск"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </nav>

      <div className="topics-viewport" id="topicsViewport">
        <div className="topics-edge topics-edge-top" aria-hidden="true" />
        <div id="topics" className="topics">
          <header className="topics-hero pane">
            <div>
              <span className="project-kicker">Учебный каталог</span>
              <h2>Темы и задания</h2>
              <p>
                Полный список курса: теория, типы заданий и прогресс по каждой
                теме. На главной — быстрый старт и сундук.
              </p>
            </div>
            <div className="topics-hero-stats">
              <span>
                <b>{totals.solvedTasks}</b> / {totals.totalTasks} заданий
              </span>
              <span>
                <b>{totals.doneTopics}</b> / {totals.totalTopics} тем
              </span>
              <Link className="btn" to="/">
                На главную
              </Link>
            </div>
          </header>

          {!visible.length ? (
            <div className="empty">
              Ничего не найдено. Измените уровень или запрос.
            </div>
          ) : (
            LEVEL_ORDER.map((lv) => {
              const topics = visible.filter((t) => t.level === lv);
              if (!topics.length) return null;
              const done = topics.reduce(
                (s, t) => s + t.tasks.filter((x) => solved.has(x.id)).length,
                0,
              );
              const total = topics.reduce((s, t) => s + t.tasks.length, 0);
              return (
                <div key={lv} className={`level-section lv-${lv}`}>
                  <div className="level-head">
                    <h2>{LEVEL_TITLE[lv]}</h2>
                    <span className="level-sub">{LEVEL_SUB[lv]}</span>
                    <span className="level-progress">
                      {done} / {total}
                    </span>
                  </div>
                  {topics.map((topic) => (
                    <TopicCard
                      key={topic.id}
                      topic={topic}
                      solved={solved}
                      open={openTopics.has(topic.id) || searchActive}
                      onHeadClick={(e) => onTopicHeadClick(e, topic.id)}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
        <div className="topics-edge topics-edge-bottom" aria-hidden="true" />
      </div>
      <SiteFooter />
    </div>
  );
}

type TopicCardProps = {
  topic: CatalogTopicModel;
  solved: ReadonlySet<string>;
  open: boolean;
  onHeadClick: (e: MouseEvent) => void;
};

function TopicCard({ topic, solved, open, onHeadClick }: TopicCardProps) {
  const solvedCount = topic.tasks.filter((t) => solved.has(t.id)).length;
  const total = topic.tasks.length;
  const pct = total ? Math.round((solvedCount / total) * 100) : 0;
  const cont = firstUnsolvedTask(topic.tasks, solved);
  const allDone = solvedCount === total && total > 0;
  const desc = topic.teaserPlain || topic.description;

  return (
    <section
      className={`topic lv-${topic.level}${allDone ? " done" : ""} topic-detailed${open ? " open" : ""}`}
      data-topic={topic.id}
    >
      <div className="topic-head" onClick={onHeadClick}>
        <span className="topic-sym" aria-hidden="true">
          {topicSymbol(topic.id)}
        </span>
        <div className="topic-title">
          <span className="topic-title-row">
            {topic.title}
            <span className={`level-badge lv-${topic.level}`}>
              {topic.level_label}
            </span>
          </span>
          <span className="topic-desc">{desc}</span>
        </div>
        <div className="topic-meta">
          <span className="topic-count">
            {solvedCount}/{total}
          </span>
          {cont ? (
            <Link
              className="btn topic-go"
              to={`/task/${cont.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              {solvedCount ? "Продолжить" : "Начать"}
            </Link>
          ) : (
            <span className="topic-done-mark">✓ пройдена</span>
          )}
          <span className="chev" aria-hidden="true">
            &#9656;
          </span>
        </div>
      </div>
      <div className="topic-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="tasklist">
        <div className="topic-theory">
          <p className="topic-theory-label">Теория темы</p>
          <TrustedCourseContent
            className="topic-theory-text"
            html={topic.teaserHtml}
          />
          <div className="theory-teaser-actions">
            <Link className="btn" to={`/topic/${topic.id}/theory`}>
              <span className="nf nf-book" aria-hidden="true" /> Открыть теорию
            </Link>
          </div>
        </div>

        {topic.tasks.map((t) => {
          const ok = solved.has(t.id);
          const xp = pointsFor({ level: t.level, challenge: t.challenge });
          return (
            <Link
              key={t.id}
              className="task-row task-row-detailed"
              to={`/task/${t.id}`}
            >
              <span className="t-id">{t.id}</span>
              <span className="t-prompt">{catalogStageTitle(t)}</span>
              <span className="t-type">{t.type}</span>
              <span className="t-xp">+{xp} XP</span>
              <span className={`t-status${ok ? " ok" : ""}`}>
                {ok ? "решено ✓" : "открыть →"}
              </span>
            </Link>
          );
        })}

        {topic.challenge ? (
          <Link
            className={`task-row challenge-row${solved.has(topic.challenge.id) ? " done" : ""}`}
            to={`/task/${topic.challenge.id}`}
          >
            <span className="t-id ch-mark">[!]</span>
            <span className="t-type">
              <b>Челлендж:</b> {topic.challenge.title}
            </span>
            <span
              className={`t-status${solved.has(topic.challenge.id) ? " ok" : " ch"}`}
            >
              {solved.has(topic.challenge.id)
                ? "пройден ✓"
                : `+${pointsFor({ level: topic.challenge.level, challenge: true })} XP · 30 капель`}
            </span>
          </Link>
        ) : null}

        {(() => {
          const insight = topicInsight(topic.id);
          if (!insight) return null;
          return (
            <div className="topic-insight">
              <p className="topic-insight-label">Где это живёт</p>
              <p className="topic-insight-text">{insight}</p>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
