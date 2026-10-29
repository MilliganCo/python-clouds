import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  LiveTerminal,
  type LiveTerminalHandle,
} from "../../components/LiveTerminal/LiveTerminal";
import { requestAiReview } from "../../services/aiMentor";
import {
  checkProjectStage,
  type ProjectCheckResult,
} from "../../services/projectCheck";
import {
  completeProjectStage,
  fetchProjectCourse,
  restoreProjectStage,
  saveProjectStage,
  startProjectCourse,
  type ProjectCourse,
  type ProjectStage,
} from "../../services/projectCourses";
import { SuccessModal } from "../task/SuccessModal";
import {
  Emblem,
  accentClass,
  snapshotKindLabel,
  statusClass,
} from "./projectUi";

function previousStageSummary(
  course: ProjectCourse,
  stageId: string,
): string {
  const stages = course.stages || [];
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx <= 0) return "";
  return stages[idx - 1]?.summary || "";
}

/**
 * Legacy `#/project/:course/:stage` — editor, check, snapshots, complete.
 */
export function ProjectStagePage() {
  const { course: courseId = "", stage: stageId = "" } = useParams<{
    course: string;
    stage: string;
  }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<ProjectCourse | null>(null);
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState<{
    ok: boolean | null;
    text: string;
  }>({ ok: null, text: "" });
  const [lastCheck, setLastCheck] = useState<ProjectCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [successNextPath, setSuccessNextPath] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const termRef = useRef<LiveTerminalHandle | null>(null);
  const lastStdoutRef = useRef("");
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starterRef = useRef("");

  const refreshSnapshots = useCallback((s: ProjectStage) => {
    setStage(s);
  }, []);

  const doSave = useCallback(
    async (nextCode: string, loud: boolean) => {
      setStatus("сохраняю...");
      const data = await saveProjectStage(
        courseId,
        stageId,
        nextCode,
        loud,
      );
      refreshSnapshots(data.stage);
      setStatus(loud ? "снимок сохранён" : "сохранено");
      setTimeout(() => {
        setStatus((cur) => (cur.startsWith("сохран") ? "" : cur));
      }, 1800);
    },
    [courseId, refreshSnapshots, stageId],
  );

  const queueAutosave = useCallback(
    (nextCode: string) => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
      autosaveRef.current = setTimeout(() => {
        void doSave(nextCode, false).catch(() => {
          setStatus("ошибка сохранения");
        });
      }, 900);
    },
    [doSave],
  );

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLocked(false);
    setLastCheck(null);
    setVerdict({ ok: null, text: "" });
    lastStdoutRef.current = "";
    termRef.current?.clear();
    (async () => {
      try {
        const data = await fetchProjectCourse(courseId);
        let c = data.course;
        if (c.status === "available") {
          const started = await startProjectCourse(courseId);
          c = started.course;
        }
        if (cancelled) return;
        const s = (c.stages || []).find((x) => x.id === stageId);
        if (!s) {
          setError("Этап не найден");
          return;
        }
        if (s.status === "unavailable" || s.status === "waiting") {
          setCourse(c);
          setStage(s);
          setLocked(true);
          return;
        }
        setCourse(c);
        setStage(s);
        const initial = s.current_code || s.starter_code || "";
        starterRef.current = s.starter_code || "";
        setCode(initial);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, [courseId, stageId]);

  function onEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = code.slice(0, start) + "    " + code.slice(end);
      setCode(next);
      queueAutosave(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void onCheck();
    }
  }

  async function onCheck() {
    if (!stage || !course) return;
    setBusy(true);
    setLastCheck(null);
    setVerdict({ ok: null, text: "" });
    try {
      await doSave(code, false);
      const result = await checkProjectStage(stage.check, code, (s) =>
        setStatus(s || ""),
      );
      setLastCheck(result);
      if (result.ok) {
        setVerdict({
          ok: true,
          text: "Проверка пройдена. Можно завершить этап.",
        });
        lastStdoutRef.current = result.stdout || "";
        termRef.current?.setStatic(result.stdout || "");
      } else {
        setVerdict({
          ok: false,
          text: result.message || "Проверьте код и подсказки.",
        });
        lastStdoutRef.current = result.stdout || result.error || "";
        termRef.current?.setStatic(
          lastStdoutRef.current,
          result.error ? "live-term-error" : undefined,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      setVerdict({ ok: false, text: msg });
      lastStdoutRef.current = msg;
      termRef.current?.setStatic(msg, "live-term-error");
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function onRunLive() {
    setBusy(true);
    setVerdict({ ok: null, text: "" });
    try {
      await doSave(code, false);
      await termRef.current?.run(code, (s) => setStatus(s || ""));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function onComplete() {
    if (!lastCheck?.ok || !course || !stage) return;
    setBusy(true);
    try {
      const data = await completeProjectStage(
        course.id,
        stage.id,
        code,
        lastCheck,
      );
      const next = data.course.next_stage;
      setSuccessMsg(
        data.stage.completion_message ||
          "Код сохранён, можно двигаться дальше.",
      );
      setSuccessNextPath(
        next
          ? `/project/${course.id}/${next.id}`
          : `/project/${course.id}`,
      );
      setReviewText(null);
      setReviewPending(true);
      setSuccessOpen(true);
      void requestAiReview(
        {
          id: `project:${course.id}:${stage.id}`,
          type: "проектный этап",
          prompt: stage.task,
          answer: stage.completion_message || "Проверяется поведением программы.",
          project_context: {
            course_title: course.title,
            stage_title: stage.title,
            previous_stage_summary: previousStageSummary(course, stage.id),
            learned_topics: stage.required_topic_titles || [],
          },
        },
        {
          ok: true,
          code,
          text: "",
          got: lastStdoutRef.current,
        },
      )
        .then((text) => {
          setReviewText(text);
          setReviewPending(false);
        })
        .catch(() => {
          setReviewPending(false);
          setReviewText(null);
        });
    } catch (e) {
      setVerdict({
        ok: false,
        text: e instanceof Error ? e.message : "Ошибка",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(snapshotId: number) {
    try {
      const data = await restoreProjectStage(courseId, stageId, snapshotId);
      setCode(data.stage.current_code || "");
      refreshSnapshots(data.stage);
      setLastCheck(null);
      setVerdict({
        ok: null,
        text: "Версия восстановлена. Запустите проверку перед завершением.",
      });
    } catch (e) {
      setVerdict({
        ok: false,
        text: e instanceof Error ? e.message : "Ошибка",
      });
    }
  }

  if (error) {
    return (
      <div className="task-page project-page">
        <div className="empty">
          <h2>Не удалось открыть этап</h2>
          <p>{error}</p>
          <Link className="btn dark" to="/projects">
            К квестам
          </Link>
        </div>
      </div>
    );
  }

  if (!course || !stage) {
    return (
      <div className="task-page project-page">
        <div className="empty">Загружаю этап...</div>
      </div>
    );
  }

  if (locked) {
    return (
      <div className={`task-page project-page ${accentClass(course)}`}>
        <div className="task-nav">
          <div className="crumbs">
            <Link to="/">Главная</Link> / <Link to="/projects">Квесты</Link> /{" "}
            <Link to={`/project/${course.id}`}>{course.short_title}</Link>
          </div>
        </div>
        <section className="pane project-locked">
          <div className="project-detail-top">
            <Emblem course={course} />
            <div>
              <span className="project-quest-tag">{course.quest_label}</span>
              <span className={statusClass(stage.status)}>
                {stage.status_label}
              </span>
              <h2>{stage.title}</h2>
            </div>
          </div>
          <p>
            Эта глава квеста откроется, когда будут готовы предыдущие шаги и
            нужные темы.
          </p>
          <p className="project-final">
            <b>Нужно пройти:</b>{" "}
            {(stage.required_topic_titles || []).join(", ")}
          </p>
          <Link className="btn dark" to={`/project/${course.id}`}>
            К главам квеста
          </Link>
        </section>
      </div>
    );
  }

  const stages = course.stages || [];
  const stageIdx = stages.findIndex((s) => s.id === stage.id);
  const chapterLabel =
    stageIdx >= 0
      ? `Глава ${stageIdx + 1} из ${stages.length}`
      : "Глава квеста";
  const prev = stageIdx > 0 ? stages[stageIdx - 1] : null;
  const next = stageIdx >= 0 ? stages[stageIdx + 1] : null;
  const snapshots = [...(stage.snapshots || [])].reverse();

  return (
    <div
      className={`task-page project-page project-stage-page ${accentClass(course)}`}
    >
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/projects">Квесты</Link> /{" "}
          <Link to={`/project/${course.id}`}>{course.short_title}</Link> /{" "}
          {stage.title}
        </div>
        <Link className="btn" to={`/project/${course.id}`}>
          К главам
        </Link>
      </div>
      <div className="project-stage-layout">
        <main className="pane project-editor-pane">
          <div className="project-stage-head">
            <Emblem course={course} size="sm" />
            <div className="task-title-row">
              <div>
                <span className="project-quest-tag">{course.quest_label}</span>
                <small className="project-stage-chapter">{chapterLabel}</small>
                <h2>{stage.title}</h2>
              </div>
              <span className={statusClass(stage.status)}>
                {stage.status_label}
              </span>
            </div>
          </div>
          <p className="project-stage-summary">{stage.summary}</p>
          <div className="project-apply">
            Теперь применяем: <b>{stage.new_knowledge || "новые темы"}</b>
          </div>
          <p className="prompt">{stage.task}</p>
          <div className="terminal-glass editable">
            <div className="terminal-label-bar">
              <span className="terminal-title">project.py</span>
              <span className="terminal-actions">
                <button
                  type="button"
                  className="term-reset-btn"
                  title="Сбросить код к исходному"
                  aria-label="Сбросить код к исходному"
                  onClick={() => {
                    setCode(starterRef.current);
                    setLastCheck(null);
                    setVerdict({ ok: null, text: "" });
                    termRef.current?.clear();
                    setStatus("Код восстановлен");
                    queueAutosave(starterRef.current);
                  }}
                >
                  <span className="nf nf-restore" aria-hidden="true" />
                </button>
              </span>
            </div>
            <textarea
              className="editor project-editor"
              spellCheck={false}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setLastCheck(null);
                queueAutosave(e.target.value);
              }}
              onKeyDown={onEditorKey}
            />
          </div>
          <div className="run-row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void doSave(code, true)}
            >
              Сохранить снимок
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void onRunLive()}
            >
              Запустить
            </button>
            <button
              type="button"
              className="btn accent"
              disabled={busy}
              onClick={() => void onCheck()}
            >
              Проверить
            </button>
            <button
              type="button"
              className="btn dark"
              disabled={busy || !lastCheck?.ok}
              onClick={() => void onComplete()}
            >
              Завершить этап
            </button>
            <span className="run-status">{status}</span>
          </div>
          <div
            className={`verdict${
              verdict.text
                ? ` show${verdict.ok === true ? " ok" : verdict.ok === false ? " fail" : ""}`
                : ""
            }`}
          >
            {verdict.ok === true ? (
              <>
                <strong>Проверка пройдена.</strong> {verdict.text.replace(/^Проверка пройдена\.\s*/, "")}
              </>
            ) : verdict.ok === false ? (
              <>
                <strong>Пока не то.</strong> {verdict.text}
              </>
            ) : (
              verdict.text
            )}
          </div>
          <div className="terminal-glass readonly output-terminal">
            <div className="terminal-label-bar">
              <span className="terminal-title">Терминал</span>
            </div>
            <div className="terminal-body project-output">
              <LiveTerminal runRef={termRef} />
            </div>
          </div>
          <div className="project-stage-nav">
            {prev ? (
              <Link className="btn" to={`/project/${course.id}/${prev.id}`}>
                Предыдущий этап
              </Link>
            ) : (
              <Link className="btn" to={`/project/${course.id}`}>
                К курсу
              </Link>
            )}
            {next &&
            next.status !== "unavailable" &&
            next.status !== "waiting" ? (
              <Link
                className="btn dark"
                to={`/project/${course.id}/${next.id}`}
              >
                Следующий этап
              </Link>
            ) : null}
          </div>
        </main>
        <aside className="project-side">
          <section className="pane">
            <h3>Подсказки</h3>
            <div className="project-hints">
              {(stage.hints || []).map((h) => (
                <p key={h}>{h}</p>
              ))}
            </div>
          </section>
          <section className="pane">
            <h3>Версии кода</h3>
            <p className="stat-note">
              Нажмите на снимок, чтобы восстановить эту версию в редактор.
            </p>
            <div className="project-snapshots">
              {snapshots.length ? (
                snapshots.map((snap) => (
                  <button
                    key={snap.id}
                    type="button"
                    className="project-snapshot"
                    onClick={() => void onRestore(snap.id)}
                  >
                    <span>
                      v{snap.version} · {snapshotKindLabel(snap.kind)}
                    </span>
                    <small>
                      {snap.created_at
                        ? new Date(snap.created_at).toLocaleString("ru-RU")
                        : ""}
                    </small>
                  </button>
                ))
              ) : (
                <p className="stat-note">
                  Снимки появятся после первого сохранения.
                </p>
              )}
            </div>
          </section>
          <section className="pane">
            <h3>Нужно знать</h3>
            <div className="project-topic-list">
              {(stage.required_topic_titles || []).map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <SuccessModal
        open={successOpen}
        points={0}
        xpLabel="Этап"
        title="Этап проекта завершён"
        message={successMsg}
        nextLabel={
          successNextPath?.includes("/") &&
          successNextPath.split("/").length > 3
            ? "Следующий этап"
            : "К проекту"
        }
        nextPath={successNextPath}
        reviewText={reviewText}
        reviewPending={reviewPending}
        onClose={() => {
          setSuccessOpen(false);
          navigate(`/project/${course.id}/${stage.id}`, { replace: true });
        }}
      />
    </div>
  );
}
