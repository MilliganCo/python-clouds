import { Link } from "react-router-dom";

type Props = {
  pathLabel: string;
};

export function NotMigratedPage({ pathLabel }: Props) {
  return (
    <section className="task-page" aria-labelledby="not-migrated-title">
      <header className="pane">
        <p className="stage-eyebrow">Миграция React</p>
        <h1 id="not-migrated-title">Маршрут ещё не перенесён</h1>
        <p className="auth-sub">
          React-версия для <code>{pathLabel}</code> пока в разработке. Ученики
          продолжают пользоваться legacy UI на порту{" "}
          <strong>8017</strong>.
        </p>
        <p className="theory-nav-links">
          <Link className="btn dark" to="/">
            На главную (React shell)
          </Link>{" "}
          <a className="btn" href="http://127.0.0.1:8017/">
            Открыть legacy
          </a>
        </p>
      </header>
    </section>
  );
}
