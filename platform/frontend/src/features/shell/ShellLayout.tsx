import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { contentRepository } from "../../content/ContentRepository";
import { apiGet } from "../../services/api";
import { parseProgress, parseWallet } from "../../services/parse";
import {
  computeRankProgress,
  type RankProgress,
} from "../../services/rankProgress";
import { onDropsChanged } from "../../services/walletEvents";
import { onProgressChanged } from "../../services/progressEvents";
import {
  applyStoredLooks,
  setLookUser,
  syncLooksFromOwnership,
} from "../../services/lookPreferences";
import { AiMentorShell } from "./AiMentorShell";
import { SandboxShell } from "./SandboxShell";
import { useBodyMode } from "./useBodyMode";

type Props = {
  username: string;
  onLogout: () => void;
};

export type ShellOutletContext = {
  username: string;
};

const NAV = [
  { to: "/", label: "Главная", end: true, route: "home" },
  { to: "/topics", label: "Темы", route: "topics" },
  { to: "/projects", label: "Квесты", route: "projects" },
  { to: "/showcase", label: "Доска", route: "showcase" },
  { to: "/game", label: "Игры", route: "game" },
  { to: "/shop", label: "Магазин", route: "shop" },
  { to: "/profile", label: "Профиль", route: "profile" },
] as const;

function navActive(route: string, pathname: string): boolean {
  if (route === "home") return pathname === "/";
  if (route === "topics") {
    return (
      pathname === "/topics" ||
      pathname.startsWith("/topics/") ||
      /^\/topic\/[^/]+\/theory/.test(pathname)
    );
  }
  if (route === "projects") {
    return pathname === "/projects" || pathname.startsWith("/project/");
  }
  if (route === "showcase") {
    return pathname === "/showcase" || pathname.startsWith("/showcase/");
  }
  if (route === "game") {
    return (
      pathname === "/game" ||
      pathname === "/games" ||
      pathname.startsWith("/game/")
    );
  }
  if (route === "shop") return pathname === "/shop";
  if (route === "profile") return pathname === "/profile";
  return false;
}

export function ShellLayout({ username, onLogout }: Props) {
  useBodyMode();
  const location = useLocation();
  const [drops, setDrops] = useState<number | null>(null);
  const [rank, setRank] = useState<RankProgress | null>(null);

  const refreshRank = useCallback(async () => {
    try {
      await contentRepository.ensureLoaded();
      const progress = await apiGet("/api/progress", parseProgress);
      const index = contentRepository.getTaskXpIndex();
      setRank(computeRankProgress(progress.solved, index));
    } catch {
      setRank(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLookUser(username);
        const wallet = await apiGet("/api/wallet", parseWallet);
        if (cancelled) return;
        setDrops(wallet.drops);
        syncLooksFromOwnership(wallet.owned || []);
      } catch {
        if (!cancelled) {
          setDrops(null);
          applyStoredLooks();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => onDropsChanged((n) => setDrops(n)), []);

  useEffect(
    () =>
      onProgressChanged(() => {
        void refreshRank();
      }),
    [refreshRank],
  );

  // Legacy renderProgress() — refresh XP/rank on every hash route change.
  useEffect(() => {
    void refreshRank();
  }, [location.pathname, refreshRank]);

  const fill = rank?.fillPercent ?? 0;

  return (
    <>
      <div id="appView">
        <a className="skip-link" href="#main-content">
          К содержанию
        </a>
        <header className="topbar">
          <h1 className="wordmark small">
            <Link to="/" className="home-link">
              Python <span>в облаках</span>
            </Link>
          </h1>

          <nav className="main-nav" aria-label="Основные разделы">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? item.end : false}
                className={() =>
                  navActive(item.route, location.pathname)
                    ? "nav-link active"
                    : "nav-link"
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div
            className="progress-card compact"
            title={rank?.statsLabel ?? "Ранг и опыт"}
          >
            <div className="rank-row">
              <span className="rank-name">{rank?.rankName ?? "…"}</span>
              <span className="xp">
                {rank != null ? `${rank.xp} XP` : "…"}
              </span>
            </div>
            <div
              className="xp-track"
              role="progressbar"
              aria-label="Прогресс до следующего ранга"
              aria-valuenow={Math.round(fill)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="xp-fill" style={{ width: `${fill.toFixed(1)}%` }} />
            </div>
            <div className="stats" hidden>
              {rank?.statsLabel}
            </div>
          </div>

          <div className="user-chip">
            <span
              className="drops-pill"
              id="dropsPill"
              title="Капли — внутренняя валюта"
            >
              <span className="drop-dot" aria-hidden="true" />
              <span>{drops ?? "—"}</span>
            </span>
            <Link className="user-link" to="/profile" title="Открыть профиль">
              {username}
            </Link>
            <button type="button" className="link-btn" onClick={onLogout}>
              выйти
            </button>
          </div>
        </header>

        <main id="main-content">
          <Outlet context={{ username } satisfies ShellOutletContext} />
        </main>
      </div>
      <SandboxShell />
      <AiMentorShell />
    </>
  );
}
