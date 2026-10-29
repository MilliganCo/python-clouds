import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  contentRepository,
  type ContentRepository,
  type TheoryLookupResult,
} from "../../content/ContentRepository";
import type { TheoryArticleModel } from "../../types/content";
import { TheoryArticleBody } from "./TheoryArticleBody";

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not_found" }
  | { status: "ready"; article: TheoryArticleModel };

type Props = {
  repository?: ContentRepository;
};

function parseTopicId(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return n;
}

export function TheoryArticlePage({
  repository = contentRepository,
}: Props) {
  const { id } = useParams<{ id: string }>();
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" });
  const h1Ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    const topicId = parseTopicId(id);

    if (topicId === null) {
      setScreen({ status: "not_found" });
      return;
    }

    setScreen({ status: "loading" });

    (async () => {
      try {
        await repository.ensureLoaded();
        if (cancelled) return;
        const result: TheoryLookupResult = repository.getTheoryArticle(topicId);
        if (cancelled) return;
        if (result.status === "ok") {
          setScreen({ status: "ready", article: result.article });
        } else if (result.status === "not_found") {
          setScreen({ status: "not_found" });
        } else {
          setScreen({ status: "error", message: result.message });
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Ошибка загрузки";
        setScreen({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, repository]);

  useEffect(() => {
    if (screen.status === "ready") {
      h1Ref.current?.focus();
    }
  }, [screen]);

  if (screen.status === "loading") {
    return (
      <div className="task-page theory-article-page">
        <p>Загрузка…</p>
      </div>
    );
  }

  if (screen.status === "error") {
    return (
      <div className="task-page theory-article-page">
        <div className="pane">
          <h1>Не удалось загрузить теорию</h1>
          <p>{screen.message}</p>
          <Link className="btn" to="/topics">
            К каталогу тем
          </Link>
        </div>
      </div>
    );
  }

  if (screen.status === "not_found") {
    return (
      <div className="task-page theory-article-page">
        <div className="pane">
          <h1>Тема не найдена</h1>
          <p>Такой темы нет в каталоге.</p>
          <Link className="btn" to="/topics">
            К каталогу тем
          </Link>
        </div>
      </div>
    );
  }

  const { article } = screen;

  return (
    <div className="task-page theory-article-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link>
          {" / "}
          <Link to="/topics">Темы</Link>
          {" / "}
          <Link to="/topics">Тема {article.topicId}</Link>
          {" / Теория"}
        </div>
        <Link className="btn" to="/topics">
          <span className="nf nf-book" aria-hidden="true" /> К каталогу
        </Link>
      </div>

      <header className="pane">
        <p className="stage-eyebrow">Теория темы {article.topicId}</p>
        <h1 ref={h1Ref} tabIndex={-1}>
          {article.title}
        </h1>
        <p className="auth-sub">{article.topicDescription}</p>
      </header>

      <TheoryArticleBody article={article} />
    </div>
  );
}
