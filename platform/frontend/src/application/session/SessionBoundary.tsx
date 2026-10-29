import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiGet, apiPost, UnauthorizedError } from "../../services/api";
import { parseMe } from "../../services/parse";
import { AuthScreen } from "../../features/shell/AuthScreen";
import { OnboardingQuiz } from "../../features/shell/OnboardingQuiz";
import { reportDiagnostic } from "../../services/clientDiagnostics";

type Props = {
  children: (ctx: {
    username: string;
    logout: () => Promise<void>;
  }) => ReactNode;
};

type Phase =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "ready"; username: string }
  | { kind: "error"; message: string };

export function SessionBoundary({ children }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [showQuiz, setShowQuiz] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiGet("/api/me", parseMe);
        if (!cancelled) setPhase({ kind: "ready", username: me.username });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          setPhase({ kind: "guest" });
          return;
        }
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Ошибка сессии",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const closeQuiz = useCallback(() => setShowQuiz(false), []);

  async function logout() {
    try {
      await apiPost("/api/logout", {}, () => null);
    } catch {
      /* ignore */
    }
    setShowQuiz(false);
    setPhase({ kind: "guest" });
  }

  if (phase.kind === "loading") {
    return <p className="auth-sub">Загрузка…</p>;
  }
  if (phase.kind === "error") {
    return (
      <p className="auth-error" role="alert">
        {phase.message}
      </p>
    );
  }
  if (phase.kind === "guest") {
    return (
      <AuthScreen
        onAuthenticated={({ username, isNew }) => {
          setPhase({ kind: "ready", username });
          if (isNew) setShowQuiz(true);
        }}
      />
    );
  }

  return (
    <>
      {children({
        username: phase.username,
        logout: async () => {
          reportDiagnostic("session_invalidated", {
            ui: "react",
            routeCategory: "session",
            errorCategory: "logout",
          });
          await logout();
        },
      })}
      <OnboardingQuiz open={showQuiz} onClose={closeQuiz} />
    </>
  );
}

/** Call from application layer when a protected request returns 401 after login. */
export function handleSessionUnauthorized(setGuest: () => void): void {
  reportDiagnostic("session_invalidated", {
    ui: "react",
    routeCategory: "session",
    errorCategory: "unauthorized",
  });
  setGuest();
}
