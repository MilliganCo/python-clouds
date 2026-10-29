import { Link } from "react-router-dom";
import { GAME_META, readBest } from "./gameMeta";

export function GamesHubPage() {
  return (
    <div className="task-page game-page games-hub-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / Мини-игры
        </div>
      </div>
      <div className="games-hub">
        {GAME_META.map((g) => {
          const best = readBest(g.bestKey);
          return (
            <Link
              key={g.id}
              className={`pane game-hub-card${g.free ? " game-hub-free" : ""}`}
              to={`/game/${g.id}`}
            >
              <span className="game-tile-icon big">{g.icon}</span>
              <h2>{g.title}</h2>
              <p>{g.sub}</p>
              <span className="dash-meta">
                {g.free
                  ? "без капель · до 5 загадок в день"
                  : best
                    ? `рекорд: ${best} очков`
                    : "ещё не играли"}
              </span>
              <span className="dash-cta">
                {g.free ? "Открыть чат →" : "Играть →"}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="games-note">
        Игры с очками — до 15 капель в день. «Загадки» — переписка с ИИ без
        наград.
      </p>
    </div>
  );
}
