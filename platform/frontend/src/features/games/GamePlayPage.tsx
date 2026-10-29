import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  Blitz,
  FillGame,
  MatchGame,
  OrderGame,
  TraceGame,
} from "@legacy-minigame";
import { apiGet, apiPost } from "../../services/api";
import { claimGameAchievements } from "../../services/claimAchievements";
import { flyDrops } from "../../services/flyDrops";
import { parseGameResult, parseWallet } from "../../services/parse";
import { emitDrops } from "../../services/walletEvents";
import {
  getGameMeta,
  isScoredGame,
  readBest,
  writeBest,
  type ScoredGameId,
} from "./gameMeta";
import { RiddlePage } from "./RiddlePage";

type Engine = {
  start: (hooks: Record<string, unknown>) => void;
  stop: () => void;
  answer?: (v: unknown) => void;
  pick?: (...args: unknown[]) => void;
  resetPick?: () => void;
};

const ENGINES: Record<ScoredGameId, Engine> = {
  blitz: Blitz as Engine,
  order: OrderGame as Engine,
  match: MatchGame as Engine,
  trace: TraceGame as Engine,
  fill: FillGame as Engine,
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Phase = "intro" | "field" | "over";

/**
 * Legacy `#/game/:name` for scored minigames — engines from static/minigame.js.
 */
export function GamePlayPage() {
  const { name = "" } = useParams<{ name: string }>();

  if (name === "riddle") return <RiddlePage />;
  if (!isScoredGame(name)) return <Navigate to="/game" replace />;

  return <ScoredGamePlay gameId={name} />;
}

function ScoredGamePlay({ gameId }: { gameId: ScoredGameId }) {
  const meta = getGameMeta(gameId)!;
  const engine = ENGINES[gameId];
  const [phase, setPhase] = useState<Phase>("intro");
  const [score, setScore] = useState(0);
  const [timerPct, setTimerPct] = useState(100);
  const [urgent, setUrgent] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [resultHtml, setResultHtml] = useState("");
  const [best, setBest] = useState(() => readBest(meta.bestKey));
  const [popClass, setPopClass] = useState("");
  const areaRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => {
      engine.stop();
      runningRef.current = false;
    };
  }, [engine]);

  const pulse = useCallback((kind: "good" | "bad") => {
    const field = fieldRef.current;
    if (!field) return;
    const cls = kind === "good" ? "game-pop-good" : "game-pop-bad";
    setPopClass("");
    requestAnimationFrame(() => setPopClass(cls));
  }, []);

  const showFlash = useCallback(
    (ok: boolean, textOk = "верно", textBad = "мимо") => {
      setFlash({ ok, text: ok ? textOk : textBad });
      pulse(ok ? "good" : "bad");
    },
    [pulse],
  );

  const finishRound = useCallback(
    async (finalScore: number) => {
      runningRef.current = false;
      setPhase("over");
      let extra = "";
      try {
        const r = await apiPost(
          "/api/game/result",
          { score: finalScore, game: gameId },
          parseGameResult,
        );
        if (r.awarded > 0) {
          flyDrops(r.awarded);
          try {
            const w = await apiGet("/api/wallet", parseWallet);
            emitDrops(w.drops);
          } catch {
            /* shell stays stale until next refresh */
          }
          extra = `Начислено <b>+${r.awarded}</b> капель.`;
        } else {
          extra =
            "Дневной лимит этой игры исчерпан — очки в удовольствие!";
        }
        const nextBest = Math.max(best, r.best || finalScore);
        writeBest(meta.bestKey, nextBest);
        setBest(nextBest);
        void claimGameAchievements();
      } catch {
        const nextBest = Math.max(best, finalScore);
        writeBest(meta.bestKey, nextBest);
        setBest(nextBest);
        void claimGameAchievements();
      }
      setResultHtml(`Ваш счёт: <b>${finalScore}</b>. ${extra}`);
    },
    [best, gameId, meta.bestKey],
  );

  const startRound = useCallback(() => {
    engine.stop();
    runningRef.current = true;
    setPhase("field");
    setScore(0);
    setFlash(null);
    setTimerPct(100);
    setUrgent(false);
    setPopClass("");

    const area = areaRef.current;
    if (!area) return;

    const commonHooks = {
      onScore: (s: number) => {
        setScore(s);
      },
      onTick: (left: number, total: number) => {
        setTimerPct((left / total) * 100);
        setUrgent(left <= 10);
      },
      onFinish: (s: number) => {
        void finishRound(s);
      },
    };

    if (gameId === "blitz") {
      area.innerHTML = `
        <pre class="game-question" id="gameQuestion"></pre>
        <div class="game-actions">
          <button class="btn game-true" type="button" id="btnTrue">Правда</button>
          <button class="btn game-false" type="button" id="btnFalse">Ложь</button>
        </div>`;
      const qEl = () => area.querySelector("#gameQuestion") as HTMLElement | null;
      area.querySelector("#btnTrue")?.addEventListener("click", () =>
        engine.answer?.(true),
      );
      area.querySelector("#btnFalse")?.addEventListener("click", () =>
        engine.answer?.(false),
      );
      engine.start({
        ...commonHooks,
        onQuestion: (q: string) => {
          const el = qEl();
          if (!el) return;
          el.textContent = q;
          el.classList.remove("question-enter");
          void el.offsetWidth;
          el.classList.add("question-enter");
        },
        onAnswer: (ok: boolean) => showFlash(ok),
      });
      return;
    }

    if (gameId === "order") {
      engine.start({
        ...commonHooks,
        onPuzzle: (
          shuffledLines: string[],
          picked: string[],
          puzzle: { goal?: string; output?: string },
        ) => {
          const expectedOutput = String(puzzle.output || "").replace(
            /\\n/g,
            "\n",
          );
          area.innerHTML = `
            <div class="order-goal">
              <span class="order-goal-label">что собрать</span>
              <b>${esc(puzzle.goal || "Соберите программу сверху вниз")}</b>
              <span class="order-output-label">ожидаемый вывод</span>
              <code>${esc(expectedOutput)}</code>
            </div>
            <div class="order-built">${
              picked
                .map((l, i) => `<pre style="--i:${i}">${esc(l)}</pre>`)
                .join("") ||
              '<span class="order-hint">Нажимайте строки в порядке выполнения программы</span>'
            }</div>
            <div class="order-pool">
              ${shuffledLines
                .map((l) =>
                  picked.includes(l)
                    ? `<button class="order-line used" disabled type="button"><code>${esc(l)}</code></button>`
                    : `<button class="order-line" type="button" data-line="${esc(l)}"><code>${esc(l)}</code></button>`,
                )
                .join("")}
            </div>
            <button class="link-btn" type="button" id="orderReset">сбросить сборку</button>`;
          area.querySelectorAll(".order-line:not(.used)").forEach((b) => {
            b.addEventListener("click", () => {
              const line = (b as HTMLElement).dataset.line;
              if (line != null) engine.pick?.(line);
            });
          });
          area
            .querySelector("#orderReset")
            ?.addEventListener("click", () => engine.resetPick?.());
        },
        onSolved: (
          ok: boolean,
          solution: string[],
          puzzle: { output?: string },
        ) => {
          showFlash(ok, "собрано! +3", "порядок неверный");
          if (!ok) {
            const expectedOutput = String(puzzle.output || "").replace(
              /\\n/g,
              "\n",
            );
            area.innerHTML = `
              <div class="order-goal">
                <span class="order-goal-label">ожидаемый вывод</span>
                <code>${esc(expectedOutput)}</code>
              </div>
              <div class="order-built solution">${solution
                .map((l) => `<pre>${esc(l)}</pre>`)
                .join("")}</div>
              <p class="order-hint">Сравните порядок: обычно первая строка создаёт данные, середина их меняет, последняя печатает результат.</p>`;
          }
        },
      });
      return;
    }

    if (gameId === "match") {
      engine.start({
        ...commonHooks,
        onBoard: (
          left: string[],
          right: string[],
          done: Set<string>,
          sel: { value: string } | null,
        ) => {
          area.innerHTML = `
            <div class="match-board">
              <div class="match-col">${left
                .map(
                  (v) => `
                <button class="match-cell ${done.has(v) ? "done" : ""} ${
                  sel && sel.value === v ? "sel" : ""
                }" type="button" data-side="left" data-v="${esc(v)}" ${
                  done.has(v) ? "disabled" : ""
                }><code>${esc(v)}</code></button>`,
                )
                .join("")}
              </div>
              <div class="match-col">${right
                .map(
                  (v) => `
                <button class="match-cell ${done.has(v) ? "done" : ""} ${
                  sel && sel.value === v ? "sel" : ""
                }" type="button" data-side="right" data-v="${esc(v)}" ${
                  done.has(v) ? "disabled" : ""
                }><code>${esc(v)}</code></button>`,
                )
                .join("")}
              </div>
            </div>`;
          area.querySelectorAll(".match-cell:not(.done)").forEach((b) => {
            b.addEventListener("click", () => {
              const el = b as HTMLElement;
              engine.pick?.(el.dataset.side, el.dataset.v);
            });
          });
        },
        onMatch: (ok: boolean) => showFlash(ok, "пара! +1", "не пара, −1"),
      });
      return;
    }

    // trace | fill
    const renderChoices = (item: {
      code?: string;
      ask?: string;
      prompt?: string;
      options: string[];
    }) => {
      if (gameId === "trace") {
        area.innerHTML = `
          <pre class="game-question trace-code">${esc(item.code)}</pre>
          <p class="game-ask">${esc(item.ask)}</p>
          <div class="game-choices">
            ${item.options
              .map(
                (o) =>
                  `<button class="btn game-choice" type="button" data-v="${esc(o)}"><code>${esc(o)}</code></button>`,
              )
              .join("")}
          </div>`;
      } else {
        area.innerHTML = `
          <p class="game-ask">${esc(item.prompt)}</p>
          <div class="game-choices">
            ${item.options
              .map(
                (o) =>
                  `<button class="btn game-choice" type="button" data-v="${esc(o)}"><code>${esc(o)}</code></button>`,
              )
              .join("")}
          </div>`;
      }
      area.querySelectorAll(".game-choice").forEach((b) => {
        b.addEventListener("click", () => {
          engine.answer?.((b as HTMLElement).dataset.v);
        });
      });
    };
    engine.start({
      ...commonHooks,
      onTrace: renderChoices,
      onFill: renderChoices,
      onAnswer: (ok: boolean) => showFlash(ok),
    });
  }, [engine, finishRound, gameId, showFlash]);

  return (
    <div className="task-page game-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/game">Мини-игры</Link> /{" "}
          {meta.title}
        </div>
      </div>
      <div className="pane game-pane">
        <div id="gameIntro" hidden={phase !== "intro"}>
          <h2 className="game-title">
            [{meta.icon}] {meta.title}
          </h2>
          <p className="game-sub">
            {meta.sub} · 60 секунд
          </p>
          <ul className="game-rules">
            {meta.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
            <li>
              Лучший результат: <b>{best}</b> очков.
            </li>
          </ul>
          <button className="btn dark" type="button" onClick={startRound}>
            Начать раунд
          </button>
        </div>

        <div
          id="gameField"
          ref={fieldRef}
          hidden={phase !== "field"}
          className={popClass}
        >
          <div className="game-hud">
            <span className="game-score">
              Очки: <b className="score-bump">{score}</b>
            </span>
            <div className={`game-timer${urgent ? " urgent" : ""}`}>
              <span
                id="gameTimerFill"
                style={{ width: `${timerPct}%` }}
              />
            </div>
          </div>
          <div id="gameArea" ref={areaRef} />
          <p
            className={`game-flash${flash ? (flash.ok ? " good" : " bad") : ""}`}
          >
            {flash?.text ?? ""}
          </p>
        </div>

        <div id="gameOver" hidden={phase !== "over"}>
          <h2 className="game-title">Раунд окончен</h2>
          <p
            className="game-result"
            dangerouslySetInnerHTML={{ __html: resultHtml }}
          />
          <div className="run-row">
            <button className="btn dark" type="button" onClick={startRound}>
              Ещё раунд
            </button>
            <Link className="btn" to="/game">
              К играм
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
