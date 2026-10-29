import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, UnauthorizedError, apiPost } from "../../services/api";
import { parseMe } from "../../services/parse";

export type AuthSuccess = {
  username: string;
  isNew: boolean;
};

type Props = {
  onAuthenticated: (result: AuthSuccess) => void;
};

type AuthMode = "login" | "register";

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/login" : "/api/register";
      const me = await apiPost(path, { username, password }, parseMe);
      onAuthenticated({ username: me.username, isNew: mode === "register" });
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ApiError) {
        setError(
          err.message ||
            (mode === "login"
              ? "Неверное имя или пароль"
              : "Не удалось создать аккаунт"),
        );
      } else {
        setError(
          mode === "login" ? "Не удалось войти" : "Не удалось создать аккаунт",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth" aria-labelledby="auth-title">
      <div className="auth-card">
        <h1 className="wordmark" id="auth-title">
          Python <span>в облаках</span>
        </h1>
        <p className="auth-sub">
          Практика Python: темы от простого к сложному, встроенный запуск кода и
          личный ИИ-помощник.
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={"auth-tab" + (mode === "login" ? " active" : "")}
            data-mode="login"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => switchMode("login")}
          >
            Вход
          </button>
          <button
            type="button"
            className={"auth-tab" + (mode === "register" ? " active" : "")}
            data-mode="register"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => switchMode("register")}
          >
            Регистрация
          </button>
        </div>

        <form id="authForm" onSubmit={onSubmit}>
          <label htmlFor="auth-username">
            Имя
            <input
              id="auth-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              required
              minLength={3}
              maxLength={32}
            />
          </label>
          <label htmlFor="auth-password">
            Пароль
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
              minLength={6}
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : (
            <p className="auth-error" id="authError" role="alert" />
          )}
          <button
            type="submit"
            className="btn dark wide"
            id="authSubmit"
            disabled={busy}
          >
            {busy
              ? mode === "login"
                ? "Входим…"
                : "Создаём…"
              : mode === "login"
                ? "Войти"
                : "Создать аккаунт"}
          </button>
        </form>
      </div>
    </section>
  );
}
