import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ACHIEVEMENTS,
} from "../../content/achievementsMeta";
import { getChangelog } from "../../content/changelog";
import {
  contentRepository,
  firstUnsolvedTask,
  type ContentRepository,
} from "../../content/ContentRepository";
import {
  LEVEL_ORDER,
  LEVEL_TITLE,
  type CatalogLevel,
} from "../../content/topicCatalogMeta";
import { apiGet } from "../../services/api";
import {
  claimDeservedAchievements,
  gameBestState,
} from "../../services/claimAchievements";
import {
  activeTitleLabel,
  getLook,
} from "../../services/lookPreferences";
import {
  parseAchievements,
  parseStats,
  parseWallet,
  type StatsPayload,
} from "../../services/parse";
import {
  computeRankProgress,
  RANKS,
  type RankProgress,
} from "../../services/rankProgress";
import type { CatalogTaskModel, CatalogTopicModel } from "../../types/content";
import type { ShellOutletContext } from "../shell/ShellLayout";

type Props = {
  repository?: ContentRepository;
};

const SURVEY_LABELS: Record<string, string> = {
  experience: "Опыт",
  goal: "Цель",
  known: "Уже знакомо",
  style: "Стиль обучения",
};

function streakWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

function barRow(
  label: string,
  done: number,
  total: number,
  href?: string | null,
) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const inner = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-nums">
        {done}/{total}
      </span>
      <span className="stat-track" aria-hidden="true">
        <span className="stat-fill" style={{ width: `${pct}%` }} />
      </span>
    </>
  );
  if (href) {
    return (
      <Link key={label} className="stat-row" to={href}>
        {inner}
      </Link>
    );
  }
  return (
    <div key={label} className="stat-row">
      {inner}
    </div>
  );
}

function activityCells(stats: StatsPayload): Array<{ day: string; n: number }> {
  const perDay: Record<string, number> = {};
  for (const s of stats.solved) {
    const k = s.solved_at.slice(0, 10);
    perDay[k] = (perDay[k] || 0) + 1;
  }
  const days: Array<{ day: string; n: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const k = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ day: k, n: perDay[k] || 0 });
  }
  return days;
}

export function ProfilePage({ repository = contentRepository }: Props) {
  const { username } = useOutletContext<ShellOutletContext>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [topics, setTopics] = useState<CatalogTopicModel[]>([]);
  const [solved, setSolved] = useState<ReadonlySet<string>>(new Set());
  const [earned, setEarned] = useState<Record<string, string>>({});
  const [survey, setSurvey] = useState<Record<string, unknown> | null>(null);
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});
  const [rank, setRank] = useState<RankProgress | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const changelog = useMemo(() => {
    try {
      return getChangelog();
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await repository.ensureLoaded();
        const catalog = repository.getCatalogTopics();
        const [st, wallet, ach] = await Promise.all([
          apiGet("/api/stats", parseStats),
          apiGet("/api/wallet", parseWallet),
          apiGet("/api/achievements", parseAchievements),
        ]);
        if (cancelled) return;

        const solvedSet = new Set(st.solved.map((s) => s.task_id));
        const allTasks = catalog.flatMap((t) => t.tasks);
        const byLevelDone: Record<string, boolean> = {};
        for (const lv of LEVEL_ORDER) {
          const tasks = allTasks.filter((t) => t.level === lv);
          byLevelDone[lv] =
            tasks.length > 0 && tasks.every((t) => solvedSet.has(t.id));
        }
        const functionSolved = allTasks.some(
          (t) =>
            solvedSet.has(t.id) &&
            (t.type.includes("функци") || t.type.includes("написать")),
        );
        const challengeSolved =
          [...solvedSet].some((id) => id.startsWith("C")) ||
          catalog.some(
            (t) => t.challenge != null && solvedSet.has(t.challenge.id),
          );

        const earnedMap = await claimDeservedAchievements(
          {
            solved: solvedSet,
            streak: st.streak,
            byLevelDone,
            functionSolved,
            challengeSolved,
            ...gameBestState(),
          },
          ach.earned,
        );

        let surveyAnswers: Record<string, unknown> | null = null;
        try {
          const s = await apiGet("/api/survey", (v) => {
            if (typeof v !== "object" || v === null) return { answers: null };
            return v as { answers: Record<string, unknown> | null };
          });
          surveyAnswers = s.answers;
        } catch {
          surveyAnswers = null;
        }

        const titles: Record<string, string> = { ...wallet.set_items };
        for (const [k, item] of Object.entries(wallet.shop)) {
          if (item.kind === "title") titles[k] = item.title;
        }

        const index = repository.getTaskXpIndex();
        setTopics(catalog);
        setStats(st);
        setSolved(solvedSet);
        setEarned(earnedMap);
        setSurvey(surveyAnswers);
        setTitleMap(titles);
        setRank(computeRankProgress([...solvedSet], index));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Ошибка загрузки");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const allTasks: CatalogTaskModel[] = useMemo(
    () => topics.flatMap((t) => t.tasks),
    [topics],
  );

  const titleLabel = activeTitleLabel(titleMap) ?? (getLook("title") ? "…" : null);

  async function exportNotes() {
    setExportBusy(true);
    try {
      const data = await apiGet("/api/notes/all", (v) => {
        if (typeof v !== "object" || v === null || !("notes" in v)) {
          throw new Error("Invalid notes");
        }
        return v as { notes: unknown };
      });
      const blob = new Blob([JSON.stringify(data.notes, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "python-v-oblakah-notes.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* ignore */
    } finally {
      setExportBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="task-page profile-page">
        <div className="empty">Загружаю профиль…</div>
      </div>
    );
  }

  if (error || !stats || !rank) {
    return (
      <div className="task-page profile-page">
        <div className="empty">{error || "Нет данных"}</div>
      </div>
    );
  }

  const streak = stats.streak;
  const since = stats.member_since
    ? new Date(stats.member_since).toLocaleDateString("ru-RU")
    : "";
  const days = activityCells(stats);

  const byLevel = LEVEL_ORDER.map((lv: CatalogLevel) => {
    const tasks = allTasks.filter((t) => t.level === lv);
    return barRow(
      LEVEL_TITLE[lv],
      tasks.filter((t) => solved.has(t.id)).length,
      tasks.length,
    );
  });

  const types = [...new Set(allTasks.map((t) => t.type))];
  const byType = types.map((tp) => {
    const tasks = allTasks.filter((t) => t.type === tp);
    return barRow(
      tp,
      tasks.filter((t) => solved.has(t.id)).length,
      tasks.length,
    );
  });

  const weak = topics
    .map((topic) => {
      const done = topic.tasks.filter((t) => solved.has(t.id)).length;
      return { topic, done, ratio: done / topic.tasks.length };
    })
    .filter((x) => x.done > 0 && x.ratio < 1)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 3);

  const weakRows =
    weak.length > 0
      ? weak.map((x) => {
          const next = firstUnsolvedTask(x.topic.tasks, solved);
          return barRow(
            x.topic.title,
            x.done,
            x.topic.tasks.length,
            next ? `/task/${next.id}` : null,
          );
        })
      : null;

  const nextRank = RANKS.find((r) => r.name === rank.nextRankName);
  const xpToNext = nextRank ? nextRank.min - rank.xp : 0;

  return (
    <div className="task-page profile-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / Профиль
        </div>
      </div>

      <div className="profile-grid">
        <div className="pane profile-hero">
          <h2 className="profile-name">
            {username}
            {titleLabel ? (
              <span className="user-title"> · {titleLabel}</span>
            ) : null}
          </h2>
          <p className="profile-sub">
            {rank.rankName} · {rank.xp} XP
            {rank.nextRankName
              ? ` · до ранга «${rank.nextRankName}» ещё ${xpToNext} XP`
              : " · максимальный ранг"}
          </p>
          <div className="profile-badges">
            <span className="chip">
              решено {solved.size} / {allTasks.length}
            </span>
            <span className={`chip${streak > 0 ? " chip-verified" : ""}`}>
              серия: {streak} {streakWord(streak)}
            </span>
            <span className="chip">
              заметок: {stats.notes_count ?? 0}
            </span>
            {since ? (
              <span className="chip">на платформе с {since}</span>
            ) : null}
          </div>
          <div className="activity-row" aria-label="Активность за 14 дней">
            {days.map((d) => (
              <span
                key={d.day}
                className={`day-cell lvl-${Math.min(d.n, 4)}`}
                title={`${d.day}: ${d.n}`}
              />
            ))}
          </div>
        </div>

        <div className="pane profile-pane-levels">
          <h3>По уровням</h3>
          <div className="stat-list">{byLevel}</div>
        </div>

        <div className="pane profile-pane-types">
          <h3>По типам заданий</h3>
          <div className="stat-list">{byType}</div>
        </div>

        <div className="pane profile-pane-weak">
          <h3>Стоит подтянуть</h3>
          <div className="stat-list">
            {weakRows ?? (
              <p className="stat-note">
                Начните несколько тем — здесь появятся те, что стоит подтянуть.
              </p>
            )}
          </div>
        </div>

        <details className="pane profile-achievements">
          <summary>
            <span>
              <b>Достижения</b>
              <small>
                {Object.keys(earned).length} / {ACHIEVEMENTS.length}
              </small>
            </span>
            <span className="profile-expand">развернуть</span>
          </summary>
          <div className="ach-grid">
            {ACHIEVEMENTS.map((a) => (
              <div
                key={a.key}
                className={`ach${earned[a.key] ? " earned" : ""}`}
                title={a.desc}
              >
                <span className="ach-icon">{a.icon}</span>
                <span className="ach-title">{a.title}</span>
              </div>
            ))}
          </div>
        </details>

        {survey ? (
          <div className="pane">
            <h3>О вас</h3>
            <div className="stat-list">
              {Object.entries(survey).map(([k, v]) => (
                <div className="stat-row" key={k}>
                  <span className="stat-label">
                    {SURVEY_LABELS[k] || k}
                  </span>
                  <span className="survey-val">
                    {Array.isArray(v) ? v.join(", ") : String(v ?? "")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="pane profile-pane-data">
          <h3>Мои данные</h3>
          <p className="stat-note">
            Заметки хранятся в вашем профиле. Можно скачать их одним файлом.
          </p>
          <button
            type="button"
            className="btn"
            id="exportNotes"
            disabled={exportBusy}
            onClick={() => void exportNotes()}
          >
            Скачать заметки (JSON)
          </button>
        </div>

        <details className="pane changelog-pane">
          <summary>Что нового на платформе</summary>
          {changelog.map((rel) => (
            <div className="rel" key={rel.date + rel.title}>
              <p className="rel-head">
                <b>{rel.title}</b>
                <span className="rel-date">{rel.date}</span>
              </p>
              <ul className="rel-list">
                {rel.items.map((item) => (
                  <li key={item.slice(0, 48)}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      </div>
    </div>
  );
}
