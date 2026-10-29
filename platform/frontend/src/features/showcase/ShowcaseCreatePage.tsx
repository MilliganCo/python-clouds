import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createShowcaseCard,
  fetchShowcaseBoard,
} from "../../services/showcase";

/**
 * Legacy `#/showcase/new` — publish form.
 */
export function ShowcaseCreatePage() {
  const navigate = useNavigate();
  const [covers, setCovers] = useState<string[]>([
    "aurora",
    "cosmos",
    "sunrise",
    "storm",
    "terminal",
  ]);
  const [canMulti, setCanMulti] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState("aurora");
  const [mainCode, setMainCode] = useState(
    'print("Привет с доски проектов!")',
  );
  const [helperName, setHelperName] = useState("helpers.py");
  const [helperCode, setHelperCode] = useState(
    'def message():\n    return "из helpers.py"',
  );
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = await fetchShowcaseBoard();
        if (cancelled) return;
        setCovers(board.covers);
        setCanMulti(board.can_multi_file);
        if (board.covers[0]) setCover(board.covers[0]);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPublish() {
    setStatus("публикую...");
    const files = [{ name: "main.py", code: mainCode }];
    if (canMulti && helperCode.trim()) {
      files.push({
        name: helperName.trim() || "helpers.py",
        code: helperCode,
      });
    }
    try {
      const res = await createShowcaseCard({
        title,
        description,
        cover,
        files,
      });
      navigate(`/showcase/${res.card.id}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка");
    }
  }

  if (error) {
    return (
      <div className="task-page project-page">
        <div className="empty">
          <h2>Не удалось открыть форму</h2>
          <p>{error}</p>
          <Link className="btn dark" to="/showcase">
            К списку
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="task-page project-page showcase-page showcase-create-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/showcase">Доска работ</Link> /
          Новый проект
        </div>
        <Link className="btn" to="/showcase">
          К списку
        </Link>
      </div>
      <section className="pane project-hero showcase-hero">
        <span className="project-kicker">Публикация</span>
        <h2>Создать свой проект</h2>
        <p>
          Название, описание, оформление и код. После публикации карточка
          появится на доске.
        </p>
      </section>
      <section className="pane showcase-create-form">
        <div className="showcase-create-grid">
          <label>
            Название
            <input
              maxLength={80}
              placeholder="Например: трекер воды"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Оформление
            <select
              value={cover}
              onChange={(e) => setCover(e.target.value)}
            >
              {covers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Описание
          <textarea
            rows={4}
            maxLength={500}
            placeholder="Что делает программа и почему её стоит запустить"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          main.py
          <textarea
            className="show-code-input"
            rows={12}
            value={mainCode}
            onChange={(e) => setMainCode(e.target.value)}
          />
        </label>
        <div className={`showcase-extra${canMulti ? "" : " locked"}`}>
          <p className="stat-note">
            {canMulti
              ? "Небесная корона активна: можно добавить helper-файл."
              : "Несколько файлов доступны с премиум-профилем «Небесная корона»."}
          </p>
          <label>
            Дополнительный файл
            <input
              value={helperName}
              disabled={!canMulti}
              onChange={(e) => setHelperName(e.target.value)}
            />
          </label>
          <textarea
            className="show-code-input"
            rows={6}
            disabled={!canMulti}
            value={helperCode}
            onChange={(e) => setHelperCode(e.target.value)}
          />
          {!canMulti ? (
            <Link className="btn" to="/shop">
              Открыть магазин
            </Link>
          ) : null}
        </div>
        <div className="showcase-create-actions">
          <button
            type="button"
            className="btn dark"
            onClick={() => void onPublish()}
          >
            Опубликовать
          </button>
          <Link className="btn" to="/showcase">
            Отмена
          </Link>
        </div>
        <p className="stat-note">{status}</p>
      </section>
    </div>
  );
}
