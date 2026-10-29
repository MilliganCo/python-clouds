import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
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
import { GAME_META, readBest } from "../games/gameMeta";
import { apiGet, apiPost } from "../../services/api";
import { flyDrops } from "../../services/flyDrops";
import {
  activeTitleLabel,
  getLook,
} from "../../services/lookPreferences";
import {
  parseChestClaim,
  parseChestStatus,
  parseDailyAi,
  parseFact,
  parseProgress,
  parseStats,
  parseWallet,
  type DailyAiPayload,
} from "../../services/parse";
import { notifySetsUnlocked } from "../../services/claimAchievements";
import { showChestToast } from "../../services/toast";
import { emitDrops } from "../../services/walletEvents";
import type { CatalogTaskModel, CatalogTopicModel } from "../../types/content";
import type { ShellOutletContext } from "../shell/ShellLayout";
import { SiteFooter } from "../shell/SiteFooter";
import { ProjectReturnPrompts } from "../projects/ProjectReturnPrompts";

const ONBOARD_KEY = "pycloud:onboarded";
const CHEST_CLOSED = "[=]";
const CHEST_MID = "[~]";
const CHEST_OPEN = "[*]";
const FACT_INTERVAL_MS = 6000;
const WEEK_GOAL = 10;
const DAILY_DIFFS = ["intermediate", "advanced", "expert"] as const;
const DAILY_RU: Record<(typeof DAILY_DIFFS)[number], string> = {
  intermediate: "средний",
  advanced: "продвинутый",
  expert: "экспертный",
};

type Props = {
  repository?: ContentRepository;
};

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      topics: CatalogTopicModel[];
      allTasks: CatalogTaskModel[];
      solved: ReadonlySet<string>;
      drops: number;
    };

type ChestUi =
  | { kind: "loading" }
  | { kind: "ready"; amount: number }
  | { kind: "opened" }
  | { kind: "opening" }
  | { kind: "unknown" };

type DailyUi =
  | { kind: "pending" }
  | { kind: "data"; payload: DailyAiPayload }
  | { kind: "later" };

function flattenTasks(topics: CatalogTopicModel[]): CatalogTaskModel[] {
  return topics.flatMap((t) => t.tasks);
}

function topicOfTask(
  topics: CatalogTopicModel[],
  taskId: string,
): CatalogTopicModel | null {
  return topics.find((t) => t.tasks.some((x) => x.id === taskId)) ?? null;
}

function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Legacy dailyTask() — deterministic pick for streak-guard link. */
function pickDailyTask(
  allTasks: CatalogTaskModel[],
  topics: CatalogTopicModel[],
  solved: ReadonlySet<string>,
  username: string,
): CatalogTaskModel | null {
  const date = new Date().toISOString().slice(0, 10);
  const touched = new Set(
    [...solved]
      .map((id) => topicOfTask(topics, id)?.id)
      .filter((id): id is number => typeof id === "number"),
  );
  let pool = allTasks.filter((t) => {
    const topic = topicOfTask(topics, t.id);
    return !solved.has(t.id) && topic && touched.has(topic.id);
  });
  if (!pool.length) {
    pool = allTasks.filter((t) => !solved.has(t.id));
  }
  if (!pool.length) return null;
  return pool[hashStr(username + date) % pool.length] ?? null;
}

function levelBars(
  allTasks: CatalogTaskModel[],
  solved: ReadonlySet<string>,
): Array<{ level: CatalogLevel; done: number; total: number; pct: number }> {
  return LEVEL_ORDER.map((lv) => {
    const tasks = allTasks.filter((t) => t.level === lv);
    const done = tasks.filter((t) => solved.has(t.id)).length;
    const total = tasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { level: lv, done, total, pct };
  });
}

export function HomePage({ repository = contentRepository }: Props) {
  const { username } = useOutletContext<ShellOutletContext>();
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" });
  const [showOnboard, setShowOnboard] = useState(false);
  const [chest, setChest] = useState<ChestUi>({ kind: "loading" });
  const [daily, setDaily] = useState<DailyUi>({ kind: "pending" });
  const [facts, setFacts] = useState<string[]>([]);
  const [factIdx, setFactIdx] = useState(0);
  const [factSwap, setFactSwap] = useState(false);
  const [streak, setStreak] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [solvedToday, setSolvedToday] = useState(true);
  const [titleLabel, setTitleLabel] = useState<string | null>(null);
  const factTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScreen({ status: "loading" });

    (async () => {
      try {
        await repository.ensureLoaded();
        const [progress, wallet, stats] = await Promise.all([
          apiGet("/api/progress", parseProgress),
          apiGet("/api/wallet", parseWallet),
          apiGet("/api/stats", parseStats).catch(() => null),
        ]);
        if (cancelled) return;
        const topics = repository.getCatalogTopics();
        const allTasks = flattenTasks(topics);
        const solved = new Set(progress.solved);
        const titles: Record<string, string> = { ...wallet.set_items };
        for (const [k, item] of Object.entries(wallet.shop)) {
          if (item.kind === "title") titles[k] = item.title;
        }
        setTitleLabel(
          activeTitleLabel(titles) ?? (getLook("title") ? "…" : null),
        );
        if (stats) {
          setStreak(stats.streak);
          const weekAgo = Date.now() - 7 * 86400000;
          setWeekCount(
            stats.solved.filter(
              (x) => new Date(x.solved_at).getTime() >= weekAgo,
            ).length,
          );
          const today = new Date().toISOString().slice(0, 10);
          setSolvedToday(
            stats.solved.some((d) => d.solved_at.slice(0, 10) === today),
          );
        }
        setScreen({
          status: "ready",
          topics,
          allTasks,
          solved,
          drops: wallet.drops,
        });
        setShowOnboard(
          solved.size === 0 && !localStorage.getItem(ONBOARD_KEY),
        );
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await apiGet("/api/chest", parseChestStatus);
        if (cancelled) return;
        if (st.ready) setChest({ kind: "ready", amount: st.amount });
        else setChest({ kind: "opened" });
      } catch {
        if (!cancelled) setChest({ kind: "unknown" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(force: boolean) {
      try {
        const d = await apiGet("/api/daily-ai", parseDailyAi, {
          cache: force ? "no-store" : "default",
        });
        if (cancelled) return;
        if (!d.tasks || Object.keys(d.tasks).length === 0) {
          throw new Error("empty");
        }
        setDaily({ kind: "data", payload: d });
        if (d.pending && attempt < 8) {
          attempt += 1;
          timer = setTimeout(() => load(true), 8000);
        }
      } catch {
        if (cancelled) return;
        if (attempt < 3) {
          setDaily({ kind: "pending" });
          attempt += 1;
          timer = setTimeout(() => load(true), 1200 * attempt);
          return;
        }
        setDaily({ kind: "later" });
      }
    }

    load(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet("/api/fact", parseFact);
        if (cancelled) return;
        setFacts(data.facts.slice(0, 3));
        setFactIdx(0);
      } catch {
        if (!cancelled) setFacts(["Не удалось загрузить факт дня."]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (facts.length < 2) return;
    if (factTimer.current) clearInterval(factTimer.current);
    factTimer.current = setInterval(() => {
      if (document.hidden) return;
      setFactIdx((i) => (i + 1) % facts.length);
      setFactSwap(true);
    }, FACT_INTERVAL_MS);
    return () => {
      if (factTimer.current) clearInterval(factTimer.current);
      factTimer.current = null;
    };
  }, [facts]);

  useEffect(() => {
    if (!factSwap) return;
    const t = setTimeout(() => setFactSwap(false), 400);
    return () => clearTimeout(t);
  }, [factIdx, factSwap]);

  async function claimChest() {
    if (chest.kind !== "ready") return;
    setChest({ kind: "opening" });
    try {
      const r = await apiPost("/api/chest/claim", {}, parseChestClaim);
      setScreen((prev) =>
        prev.status === "ready" ? { ...prev, drops: r.drops } : prev,
      );
      emitDrops(r.drops);
      if (r.amount > 0) flyDrops(r.amount);
      window.setTimeout(() => {
        setChest({ kind: "opened" });
        if (r.amount > 0) showChestToast(r.amount);
        notifySetsUnlocked(r.sets_unlocked);
      }, 320);
    } catch {
      setChest({ kind: "opened" });
    }
  }

  function dismissOnboard() {
    localStorage.setItem(ONBOARD_KEY, "1");
    setShowOnboard(false);
  }

  if (screen.status === "loading") {
    return (
      <div className="dashboard">
        <p>Загрузка…</p>
      </div>
    );
  }

  if (screen.status === "error") {
    return (
      <div className="dashboard">
        <div className="pane">
          <h2>Не удалось загрузить главную</h2>
          <p>{screen.message}</p>
        </div>
      </div>
    );
  }

  const { topics, allTasks, solved, drops } = screen;
  const done = [...solved].filter((id) =>
    allTasks.some((t) => t.id === id),
  ).length;
  const next = firstUnsolvedTask(allTasks, solved);
  const nextTopic = next ? topicOfTask(topics, next.id) : null;
  const dailyPick = pickDailyTask(allTasks, topics, solved, username);
  const showStreakGuard = streak > 0 && !solvedToday && !!dailyPick;
  const hello =
    done === 0
      ? "Добро пожаловать! Начнём с самых основ."
      : `С возвращением! Решено ${done} из ${allTasks.length}.`;
  const bars = levelBars(allTasks, solved);

  const chestArt =
    chest.kind === "opening"
      ? CHEST_MID
      : chest.kind === "opened"
        ? CHEST_OPEN
        : CHEST_CLOSED;
  const chestReady = chest.kind === "ready";
  const chestDisabled =
    chest.kind === "opened" ||
    chest.kind === "opening" ||
    chest.kind === "loading" ||
    chest.kind === "unknown";
  const chestHint =
    chest.kind === "ready"
      ? `Ежедневный сундук · кликните, +${chest.amount} капель`
      : chest.kind === "opening"
        ? "Открываю…"
        : chest.kind === "opened"
          ? "Ежедневный сундук · завтра снова"
          : "Ежедневный сундук";

  return (
    <div className="dashboard">
      <p className="dash-hello">
        Привет, <b>{username}</b>
        {titleLabel ? (
          <>
            {" "}
            <span className="user-title">· {titleLabel}</span>
          </>
        ) : null}
        . {hello}
      </p>

      {showOnboard ? (
        <div className="onboard" id="onboard">
          <p className="onboard-title">Как здесь всё устроено</p>
          <ul className="onboard-list">
            <li>
              <b>Темы идут от простого к сложному</b> — откройте раздел «Темы»
              или жмите «Продолжить обучение».
            </li>
            <li>
              В каждом задании: <b>подсказки</b>, <b>ИИ-наставник</b> и запуск
              кода прямо в браузере.
            </li>
            <li>
              Капли — внутренняя валюта: задания, сундук и мини-игры. Тратятся
              в <b>магазине</b>.
            </li>
          </ul>
          <button type="button" className="btn" onClick={dismissOnboard}>
            Понятно, начинаем
          </button>
        </div>
      ) : null}

      {showStreakGuard && dailyPick ? (
        <Link className="streak-guard" to={`/task/${dailyPick.id}`}>
          <b>
            Серия {streak}{" "}
            {streak === 1 ? "день" : streak < 5 ? "дня" : "дней"} под угрозой!
          </b>{" "}
          Решите одно задание сегодня, чтобы её сохранить →
        </Link>
      ) : null}

      {done < 3 ? (
        <div className="dash-card bento-pyintro">
          <span className="dash-label">Знакомство с Python</span>
          <p className="pyintro-text">
            Python читается почти как английский — с него чаще всего начинают.
            Курс ведёт от первой переменной к классам маленькими шагами.
          </p>
        </div>
      ) : null}

      <ProjectReturnPrompts />

      <div className="bento">
        {next ? (
          <Link className="dash-card bento-continue" to={`/task/${next.id}`}>
            <span className="dash-label">Продолжить обучение</span>
            <span className="dash-title big">
              {nextTopic?.title ?? "Задание"}
            </span>
            <span className="dash-meta">
              задание {next.id} · {next.type}
            </span>
            <span className="dash-cta">Продолжить →</span>
          </Link>
        ) : (
          <div className="dash-card bento-continue">
            <span className="dash-label">Курс пройден</span>
            <span className="dash-title big">
              Все {allTasks.length} заданий решены!
            </span>
          </div>
        )}

        <div className="dash-card dash-daily bento-daily" id="dailyAiCard">
          <span className="dash-label">Задания дня · от наставника</span>
          <div className="daily-ai-list" id="dailyAiList">
            <DailyAiTiles daily={daily} />
          </div>
        </div>

        <button
          type="button"
          className={`dash-card bento-chest${chestReady ? " ready" : ""}${chest.kind === "opened" ? " opened" : ""}${chest.kind === "opening" ? " opening" : ""}`}
          id="chestCard"
          disabled={chestDisabled}
          title={chestHint}
          aria-label={chestHint}
          onClick={() => void claimChest()}
        >
          <span className="chest-art" id="chestArt" aria-hidden="true">
            {chestArt}
          </span>
        </button>

        <div className="dash-card bento-fact" id="factCard">
          <span className="dash-label">Факты дня</span>
          <div className="fact-rotate" id="factRotate" aria-live="polite">
            <p
              className={`fact-text${factSwap ? " fact-swap" : ""}`}
              id="factText"
            >
              {facts[factIdx] ?? "Загружаю…"}
            </p>
            {facts.length > 1 ? (
              <div className="fact-dots" id="factDots">
                {facts.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`fact-dot${i === factIdx ? " active" : ""}`}
                    aria-label={`Факт ${i + 1}`}
                    onClick={() => {
                      setFactIdx(i);
                      setFactSwap(true);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="dash-card bento-games">
          <span className="dash-label">Мини-игры · капли за очки</span>
          <div className="bento-games-row">
            {(
              [
                ["blitz", "правда/ложь"],
                ["order", "собери код"],
                ["match", "код и результат"],
                ["trace", "значение после шагов"],
                ["fill", "оператор или функция"],
                ["riddle", "ИИ · без капель"],
              ] as const
            ).map(([id, baseSub]) => {
              const g = GAME_META.find((x) => x.id === id)!;
              const best = readBest(g.bestKey);
              const sub =
                id === "riddle"
                  ? baseSub
                  : `${baseSub}${best ? " · " + best : ""}`;
              return (
                <Link
                  key={id}
                  className={`game-tile${g.free ? " game-tile-free" : ""}`}
                  to={`/game/${id}`}
                >
                  <span className="game-tile-icon">{g.icon}</span>
                  <span>{g.title}</span>
                  <span className="game-tile-sub">{sub}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <Link className="dash-card bento-topics" to="/topics">
          <span className="dash-label">Каталог тем</span>
          <span className="dash-title">
            {topics.length} тем · {allTasks.length} заданий
          </span>
          <span className="dash-meta">
            уровни, теория, список задач и поиск по курсу
          </span>
          <span className="dash-cta">Открыть темы →</span>
        </Link>

        <Link className="dash-card bento-projects" to="/projects">
          <span className="dash-label">Проектные квесты</span>
          <span className="dash-title">5 квестов по возрастающей сложности</span>
          <span className="dash-meta">
            бот → постер → анализатор → трекер → игра — открываются после нужных
            тем
          </span>
          <span className="dash-cta">Открыть квесты →</span>
        </Link>

        <Link className="dash-card bento-showcase" to="/showcase">
          <span className="dash-label">Доска работ</span>
          <span className="dash-title">Витрина программ</span>
          <span className="dash-meta">
            публикация, запуск чужого кода и голосование облачками
          </span>
          <span className="dash-cta">Открыть доску →</span>
        </Link>

        <Link className="dash-card bento-progress" to="/profile">
          <span className="dash-label">Ваш путь</span>
          {bars.map((b) => (
            <div key={b.level} className="bento-lvl">
              <span>{LEVEL_TITLE[b.level].split(" ")[0]}</span>
              <span className="stat-track">
                <span style={{ width: `${b.pct}%` }} />
              </span>
              <span className="stat-num">
                {b.done}/{b.total}
              </span>
            </div>
          ))}
          <div className="bento-lvl">
            <span>Неделя</span>
            <span className="stat-track goal">
              <span
                style={{
                  width: `${Math.min(100, Math.round((weekCount / WEEK_GOAL) * 100))}%`,
                }}
              />
            </span>
            <span className="stat-num">
              {weekCount}/{WEEK_GOAL}
            </span>
          </div>
          {streak > 0 ? (
            <div className="bento-lvl streak-line">
              <span>Серия</span>
              <span className="streak-flame">
                {streak}{" "}
                {streak === 1 ? "день" : streak < 5 ? "дня" : "дней"}
              </span>
            </div>
          ) : null}
          <span className="dash-cta">Профиль и достижения →</span>
        </Link>

        <Link className="dash-card bento-shop" to="/shop">
          <span className="dash-label">Магазин</span>
          <span className="dash-title">Скины неба, темы, заморозки</span>
          <span className="dash-meta">
            у вас <b>{drops}</b> капель
          </span>
          <span className="dash-cta">В магазин →</span>
        </Link>
      </div>
      <SiteFooter />
    </div>
  );
}

function DailyAiTiles({ daily }: { daily: DailyUi }) {
  if (daily.kind === "later") {
    return (
      <>
        {DAILY_DIFFS.map((diff) => (
          <span key={diff} className="daily-ai-tile pending">
            <span className={`daily-ai-diff lv-${diff}`}>{DAILY_RU[diff]}</span>
            <span className="daily-ai-title review-wait">позже</span>
          </span>
        ))}
      </>
    );
  }

  if (daily.kind === "pending") {
    return (
      <>
        {DAILY_DIFFS.map((diff) => (
          <span key={diff} className="daily-ai-tile pending">
            <span className={`daily-ai-diff lv-${diff}`}>{DAILY_RU[diff]}</span>
            <span className="daily-ai-title review-wait">…</span>
          </span>
        ))}
      </>
    );
  }

  const d = daily.payload;
  return (
    <>
      {DAILY_DIFFS.map((diff) => {
        const t = d.tasks[diff];
        if (!t) {
          return (
            <span key={diff} className="daily-ai-tile pending">
              <span className={`daily-ai-diff lv-${diff}`}>
                {DAILY_RU[diff]}
              </span>
              <span className="daily-ai-title review-wait">готовим…</span>
            </span>
          );
        }
        const done = d.solved.includes(diff);
        const dropN = d.drops[diff] ?? 0;
        return (
          <Link
            key={diff}
            className={`daily-ai-tile${done ? " done" : ""}`}
            to={`/daily/${diff}`}
          >
            <span className={`daily-ai-diff lv-${diff}`}>{DAILY_RU[diff]}</span>
            <span className="daily-ai-title">{t.title}</span>
            <span className="daily-ai-status">
              {done ? "✓" : `+${dropN}`}
            </span>
          </Link>
        );
      })}
    </>
  );
}
