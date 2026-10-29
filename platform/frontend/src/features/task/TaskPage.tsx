import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { SafeMarkdown } from "../../components/SafeMarkdown/SafeMarkdown";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import {
  contentRepository,
  type ContentRepository,
  type TaskLookupResult,
} from "../../content/ContentRepository";
import { requestAiReview } from "../../services/aiMentor";
import { apiGet, apiPost } from "../../services/api";
import { gradeTask } from "../../services/gradeTask";
import { sanitizeCourseHtml } from "../../services/legacyContent";
import { parseProgress, parseProgressPost } from "../../services/parse";
import { pointsFor } from "../../services/rankProgress";
import { pythonRunner } from "../../services/pythonRunner";
import type { TaskPageModel, TaskQuestionModel } from "../../types/content";
import { generateChoices } from "./generateChoices";
import { CourseRail } from "./CourseRail";
import { HintsPane } from "./HintsPane";
import { inlineCourseText } from "./inlineCourseText";
import { NotesPane } from "./NotesPane";
import { draftKey, starterCodeFor } from "./starterCode";
import { StageIntroPage } from "./StageIntroPage";
import { SuccessModal } from "./SuccessModal";
import { flyDrops } from "../../services/flyDrops";
import { claimAchievementsAfterSolve } from "../../services/claimAchievements";
import { emitDrops } from "../../services/walletEvents";
import { emitProgressChanged } from "../../services/progressEvents";

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not_found" }
  | { status: "ready"; task: TaskPageModel; nextId: string | null };

type VerdictState =
  | { kind: "idle" }
  | { kind: "ok"; message: string; explanation?: string }
  | { kind: "fail"; message: string; detail?: string }
  | {
      kind: "self";
      answer: string;
      explanation: string;
    };

type Props = {
  repository?: ContentRepository;
};

function readDraft(id: string, starter: string): string {
  try {
    return localStorage.getItem(draftKey(id)) ?? starter;
  } catch {
    return starter;
  }
}

function writeDraft(id: string, code: string): void {
  try {
    localStorage.setItem(draftKey(id), code);
  } catch {
    /* ignore */
  }
}

function clearDraft(id: string): void {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}

function quizStepsFor(task: TaskPageModel): TaskQuestionModel[] | null {
  if (task.type !== "квиз") return null;
  if (Array.isArray(task.questions) && task.questions.length) {
    return task.questions;
  }
  return [
    {
      prompt: task.prompt,
      answer: task.answer,
      wrong: task.wrong,
      explanation: task.explanation,
    },
  ];
}

function InlineHtml({ source, className }: { source: string; className?: string }) {
  const html = sanitizeCourseHtml(inlineCourseText(source));
  return <TrustedCourseContent html={html} className={className} as="span" />;
}

export function TaskPage({ repository = contentRepository }: Props) {
  const { id } = useParams<{ id: string }>();
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" });
  const [code, setCode] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [selectedChoice, setSelectedChoice] = useState("");
  const [output, setOutput] = useState("");
  const [outputErr, setOutputErr] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<VerdictState>({ kind: "idle" });
  const [solved, setSolved] = useState(false);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAwaitNext, setQuizAwaitNext] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [reviewText, setReviewText] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [solvedIds, setSolvedIds] = useState<ReadonlySet<string>>(new Set());
  const [introMeta, setIntroMeta] = useState<{
    topicTaskIds: string[];
    prevTopics: Array<{ id: number; title: string; taskIds: string[] }>;
  } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const h2Ref = useRef<HTMLHeadingElement>(null);
  const reviewSeq = useRef(0);

  const closeSuccess = useCallback(() => setSuccessOpen(false), []);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setScreen({ status: "not_found" });
      return;
    }
    setScreen({ status: "loading" });
    setVerdict({ kind: "idle" });
    setSolved(false);
    setShowIntro(false);
    setIntroMeta(null);
    setOutput("");
    setAnswerText("");
    setSelectedChoice("");
    setQuizIdx(0);
    setQuizAwaitNext(false);
    setSuccessOpen(false);
    setReviewText(null);
    setReviewPending(false);
    reviewSeq.current += 1;

    (async () => {
      try {
        await repository.ensureLoaded();
        if (cancelled) return;
        const result: TaskLookupResult = repository.getTask(id);
        if (cancelled) return;
        if (result.status === "ok") {
          const starter = starterCodeFor(result.task);
          setCode(readDraft(result.task.id, starter));
          let solvedSet = new Set<string>();
          try {
            const progress = await apiGet("/api/progress", parseProgress);
            if (!cancelled) {
              solvedSet = new Set(progress.solved);
              setSolvedIds(solvedSet);
              setSolved(solvedSet.has(result.task.id));
            }
          } catch {
            /* intro without progress still ok */
          }
          const needIntro =
            !result.task.challenge && !solvedSet.has(result.task.id);
          setShowIntro(needIntro);
          setIntroMeta({
            topicTaskIds: repository.getTopicTaskIds(result.task.topicId),
            prevTopics: repository.getPrevTopics(result.task.topicId),
          });
          setScreen({
            status: "ready",
            task: result.task,
            nextId: repository.getNextTaskId(result.task.id),
          });
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
      h2Ref.current?.focus();
      void pythonRunner.warmup();
    }
  }, [screen]);

  const task = screen.status === "ready" ? screen.task : null;
  const nextId = screen.status === "ready" ? screen.nextId : null;

  const isPrediction = task?.type === "определить вывод";
  const isQuiz = task?.type === "квиз";
  const isDemo = task?.type === "демо";
  const isExplain = task?.type === "объяснить поведение";
  const hasEditor =
    !!task && ((!isPrediction && !isExplain && !isQuiz) || isDemo);

  const quizSteps = useMemo(
    () => (task ? quizStepsFor(task) : null),
    [task],
  );

  const choiceSource = useMemo(() => {
    if (!task) return null;
    if (isPrediction) return task;
    if (isQuiz && quizSteps) return quizSteps[quizIdx] ?? null;
    return null;
  }, [task, isPrediction, isQuiz, quizSteps, quizIdx]);

  const choices = useMemo(
    () => (choiceSource ? generateChoices(choiceSource) : null),
    [choiceSource],
  );

  const points = task
    ? pointsFor({ level: task.topicLevel, challenge: task.challenge })
    : 0;

  const showFixBtn =
    isDemo &&
    task &&
    task.answer &&
    !/^#\s*демо/i.test(task.answer.trim());

  function persistCode(next: string) {
    setCode(next);
    if (task) writeDraft(task.id, next);
  }

  function onEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = code.slice(0, start) + "    " + code.slice(end);
      persistCode(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
  }

  async function markSolved() {
    if (!task) return;
    const res = await apiPost(
      "/api/progress",
      { task_id: task.id, solved: true },
      parseProgressPost,
    );
    setSolved(true);
    const nextSolved = new Set(solvedIds);
    nextSolved.add(task.id);
    setSolvedIds(nextSolved);
    if (res.drops_awarded > 0) {
      flyDrops(res.drops_awarded);
      if (typeof res.drops === "number") emitDrops(res.drops);
    }
    void claimAchievementsAfterSolve(nextSolved).finally(() => {
      emitProgressChanged();
    });
    clearDraft(task.id);
    setSuccessOpen(true);
  }

  function kickReview(attempt: {
    ok: boolean;
    code?: string;
    text?: string;
    error?: string;
    got?: string;
  }) {
    if (!task) return;
    const my = ++reviewSeq.current;
    setReviewText(null);
    setReviewPending(true);
    void (async () => {
      try {
        const text = await requestAiReview(
          {
            id: task.id,
            type: task.type,
            prompt: task.prompt,
            answer: task.answer,
          },
          attempt,
        );
        if (my !== reviewSeq.current) return;
        if (text) {
          setReviewText(text);
          setReviewPending(false);
        } else {
          setReviewPending(false);
        }
      } catch {
        if (my === reviewSeq.current) setReviewPending(false);
      }
    })();
  }

  async function onRun() {
    if (!task || !hasEditor) return;
    setBusy(true);
    setOutput("");
    setOutputErr(false);
    try {
      const r = await pythonRunner.run(code, {
        onStatus: (s) => setRunStatus(s || ""),
      });
      if (r.ok) {
        setOutput(r.stdout || "(нет вывода)");
        setOutputErr(false);
      } else if (r.error.kind === "python") {
        setOutput((r.error.stdout || "") + r.error.traceback);
        setOutputErr(true);
      } else {
        setOutput(
          "message" in r.error
            ? r.error.message
            : r.error.kind === "timeout"
              ? "Превышено время выполнения."
              : "Ошибка запуска",
        );
        setOutputErr(true);
      }
    } finally {
      setRunStatus("");
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!task) return;
    setBusy(true);
    setVerdict({ kind: "idle" });
    if (!isDemo) {
      setOutput("");
      setOutputErr(false);
    }

    try {
      if (isDemo) {
        await markSolved();
        setVerdict({
          kind: "ok",
          message: `Отлично! +${points} XP`,
          explanation: task.explanation || undefined,
        });
        return;
      }

      if (isQuiz && quizSteps) {
        if (quizAwaitNext) {
          setQuizAwaitNext(false);
          setSelectedChoice("");
          setVerdict({ kind: "idle" });
          return;
        }
        if (choices && !selectedChoice.trim()) {
          setVerdict({
            kind: "fail",
            message: "Сначала выберите один из вариантов ответа.",
          });
          return;
        }
        const step = quizSteps[quizIdx]!;
        const stepRes = await gradeTask(
          { ...task, answer: step.answer, type: "квиз" },
          { text: selectedChoice },
        );
        if (stepRes.kind !== "auto" || !stepRes.ok) {
          setVerdict({ kind: "fail", message: "Пока не то. Подумайте ещё раз." });
          return;
        }
        setVerdict({
          kind: "ok",
          message: "Верно!",
          explanation: step.explanation || undefined,
        });
        if (quizIdx < quizSteps.length - 1) {
          setQuizIdx((i) => i + 1);
          setQuizAwaitNext(true);
          setSelectedChoice("");
          return;
        }
        await markSolved();
        return;
      }

      if (choices && !selectedChoice.trim() && (isPrediction || isQuiz)) {
        setVerdict({
          kind: "fail",
          message: "Сначала выберите один из вариантов ответа.",
        });
        return;
      }

      const payload = hasEditor
        ? { code }
        : { text: choices ? selectedChoice : answerText };

      const res = await gradeTask(task, payload, {
        onStatus: (s) => setRunStatus(s || ""),
      });

      if (res.kind === "blocked") {
        setVerdict({ kind: "fail", message: res.error });
        return;
      }

      if (res.kind === "self") {
        setVerdict({
          kind: "self",
          answer: task.answer,
          explanation: task.explanation,
        });
        return;
      }

      if (res.kind === "auto") {
        kickReview({
          ok: res.ok,
          code: hasEditor ? code : undefined,
          text: hasEditor ? undefined : choices ? selectedChoice : answerText,
          error: res.error,
          got: res.got,
        });
      }

      if (res.ok) {
        await markSolved();
        setVerdict({
          kind: "ok",
          message: `Принято! +${points} XP`,
          explanation:
            isPrediction && task.explanation ? task.explanation : undefined,
        });
      } else if (res.error) {
        setVerdict({
          kind: "fail",
          message: "Ошибка выполнения.",
          detail: res.error,
        });
      } else {
        setVerdict({
          kind: "fail",
          message: "Пока не то.",
          detail:
            res.expected != null
              ? `ожидалось:\n${res.expected}\n\nполучено:\n${res.got ?? ""}`
              : undefined,
        });
      }
    } catch (err) {
      setVerdict({
        kind: "fail",
        message: err instanceof Error ? err.message : "Ошибка проверки",
      });
    } finally {
      setRunStatus("");
      setBusy(false);
    }
  }

  async function onSelfOk() {
    if (!task) return;
    setBusy(true);
    try {
      await markSolved();
      setVerdict({ kind: "ok", message: `Засчитано! +${points} XP` });
    } catch (err) {
      setVerdict({
        kind: "fail",
        message: err instanceof Error ? err.message : "Ошибка",
      });
    } finally {
      setBusy(false);
    }
  }

  if (screen.status === "loading") {
    return (
      <div className="task-page">
        <p>Загрузка…</p>
      </div>
    );
  }

  if (screen.status === "error") {
    return (
      <div className="task-page">
        <div className="pane">
          <h1>Не удалось загрузить задание</h1>
          <p>{screen.message}</p>
          <Link className="btn" to="/topics">
            К каталогу тем
          </Link>
        </div>
      </div>
    );
  }

  if (screen.status === "not_found" || !task) {
    return (
      <div className="task-page">
        <div className="pane">
          <h1>Задание не найдено</h1>
          <p>Такого этапа нет в каталоге.</p>
          <Link className="btn" to="/topics">
            К каталогу тем
          </Link>
        </div>
      </div>
    );
  }

  if (showIntro && introMeta) {
    const theory = repository.getTheoryArticle(task.topicId);
    if (theory.status === "ok") {
      return (
        <StageIntroPage
          task={task}
          article={theory.article}
          topicTaskIds={introMeta.topicTaskIds}
          prevTopics={introMeta.prevTopics}
          solved={solvedIds}
          onBegin={() => {
            setShowIntro(false);
            window.scrollTo(0, 0);
          }}
        />
      );
    }
  }

  const introText = task.intro.goal || task.intro.text;
  const titleText = task.challenge
    ? task.title
    : task.title
      ? `Этап ${task.id} · ${task.title}`
      : `Этап ${task.id}`;

  const quizHint =
    isQuiz && quizSteps
      ? quizSteps.length > 1
        ? `Вопрос ${quizIdx + 1} из ${quizSteps.length}. ${quizSteps[quizIdx]?.prompt ?? ""}`
        : quizSteps[quizIdx]?.prompt ?? ""
      : null;

  const submitLabel = isDemo
    ? "Далее"
    : isExplain
      ? "Сверить с эталоном"
      : quizAwaitNext
        ? "Следующий вопрос"
        : "Отправить на проверку";

  return (
    <div className="task-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link>
          {" / "}
          <Link to="/topics">Темы</Link>
          {" / "}
          {task.topicTitle}{" "}
          <span className={`level-badge lv-${task.topicLevel}`}>
            {task.topicLevelLabel}
          </span>
        </div>
      </div>

      <div className="task-layout">
        <div className="task-main">
          <div className="pane intro-pane">
            <p className="intro-label">Что тренируем</p>
            <p className="intro-text">
              {introText ? <InlineHtml source={introText} /> : null}
            </p>
            <div className="theory-teaser-actions">
              <Link className="btn" to={`/topic/${task.topicId}/theory`}>
                <span className="nf nf-book" aria-hidden="true" /> Теория темы
              </Link>
            </div>
          </div>

          <div className="pane flow-task">
            <div className="task-title-row">
              <h2 ref={h2Ref} tabIndex={-1}>
                {task.challenge ? (
                  titleText
                ) : (
                  <InlineHtml source={titleText} />
                )}
              </h2>
              {task.challenge ? (
                <span className="chip ch-chip">[!] челлендж темы</span>
              ) : (
                <button
                  type="button"
                  className="link-btn stage-back"
                  title="Вернуться к вводному уроку этапа"
                  onClick={() => {
                    setShowIntro(true);
                    window.scrollTo(0, 0);
                  }}
                >
                  ↺ вводная этапа
                </button>
              )}
              <span className="chip">{task.type}</span>
              <span className="chip">+{points} XP</span>
              <Link
                className="chip chip-link"
                to={`/topic/${task.topicId}/theory`}
                title="Теория темы"
              >
                <span className="nf nf-book" aria-hidden="true" />
                <span className="chip-label">Теория</span>
              </Link>
              <span
                className="chip solved-flag"
                hidden={!solved}
                id="solvedFlag"
              >
                решено
              </span>
            </div>

            <p className="prompt">
              <InlineHtml source={task.prompt} />
            </p>

            {task.code && (isPrediction || isExplain) ? (
              <div className="terminal-glass readonly">
                <div className="terminal-label-bar">
                  <span className="terminal-title">program.py</span>
                </div>
                <pre className="terminal-body">
                  <code>{task.code}</code>
                </pre>
              </div>
            ) : null}

            <div className="answer-zone" id="answerZone">
              {isPrediction || isQuiz ? (
                <>
                  <h3>Ваш ответ</h3>
                  {quizHint ? (
                    <p className="answer-hint quiz-q">
                      <InlineHtml source={quizHint} />
                    </p>
                  ) : (
                    <p className="answer-hint">Выберите один вариант:</p>
                  )}
                  {choices ? (
                    <div className="choice-grid" id="choiceGrid">
                      {choices.map((c, i) => (
                        <button
                          key={`${quizIdx}-${c}-${i}`}
                          type="button"
                          className={
                            "choice-btn" +
                            (selectedChoice === c ? " selected" : "")
                          }
                          data-value={c}
                          onClick={() => setSelectedChoice(c)}
                        >
                          <span className="choice-letter">
                            {String.fromCharCode(65 + i)}
                          </span>
                          <code className="choice-text">{c}</code>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      className="answer-input"
                      spellCheck={false}
                      placeholder="вывод программы"
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                    />
                  )}
                </>
              ) : isExplain ? (
                <>
                  <h3>Ваше объяснение</h3>
                  <textarea
                    className="answer-input prose"
                    placeholder="Объясните своими словами, почему программа ведёт себя именно так"
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <h3>{isDemo ? "Попробуйте сами" : "Решение"}</h3>
                  <div className="terminal-glass editable">
                    <div className="terminal-label-bar">
                      <span className="terminal-title">
                        {isDemo ? "demo.py" : "solution.py"}
                      </span>
                      <span className="terminal-actions">
                        <button
                          type="button"
                          className="term-reset-btn"
                          title="Сбросить код к исходному"
                          aria-label="Сбросить код к исходному"
                          onClick={() => {
                            const starter = starterCodeFor(task);
                            clearDraft(task.id);
                            setCode(starter);
                            setOutput("");
                            setVerdict({ kind: "idle" });
                            setRunStatus("Код восстановлен");
                          }}
                        >
                          <span className="nf nf-restore" aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                    <textarea
                      ref={editorRef}
                      className="editor"
                      id="editor"
                      spellCheck={false}
                      value={code}
                      onChange={(e) => persistCode(e.target.value)}
                      onKeyDown={onEditorKeyDown}
                    />
                  </div>
                </>
              )}

              <div className="run-row">
                {hasEditor ? (
                  <button
                    className={
                      "btn" + (task.topicId === 0 ? " run-hint-pulse" : "")
                    }
                    type="button"
                    id="runBtn"
                    disabled={busy}
                    onClick={() => void onRun()}
                  >
                    Запустить
                  </button>
                ) : null}
                {showFixBtn ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      persistCode(task.answer);
                    }}
                  >
                    Показать исправление
                  </button>
                ) : null}
                <button
                  className="btn dark"
                  type="button"
                  id="submitBtn"
                  disabled={busy}
                  onClick={() => void onSubmit()}
                >
                  {submitLabel}
                </button>
                <span className="run-status" id="runStatus">
                  {runStatus}
                </span>
              </div>

              {hasEditor ? (
                <div className="task-output-wrap">
                  <div className="terminal-glass editable">
                    <div className="terminal-label-bar">
                      <span className="terminal-title">вывод</span>
                    </div>
                    <pre
                      className={
                        "terminal-body output" + (outputErr ? " err" : "")
                      }
                      id="output"
                    >
                      {output}
                    </pre>
                  </div>
                </div>
              ) : null}

              <div
                className={
                  "verdict" +
                  (verdict.kind !== "idle" ? " show" : "") +
                  (verdict.kind === "ok" ? " ok" : "") +
                  (verdict.kind === "fail" ? " fail" : "")
                }
                id="verdict"
                style={
                  verdict.kind === "self"
                    ? {
                        background: "rgba(61,127,211,0.08)",
                        border: "1px solid rgba(61,127,211,0.3)",
                      }
                    : undefined
                }
              >
                {verdict.kind === "ok" ? (
                  <>
                    <strong>{verdict.message}</strong>
                    {verdict.explanation ? (
                      <div className="quiz-explain">
                        <InlineHtml source={verdict.explanation} />
                      </div>
                    ) : null}
                    {solved ? (
                      <div className="self-actions" style={{ marginTop: 12 }}>
                        {nextId && !task.challenge ? (
                          <Link className="btn dark" to={`/task/${nextId}`}>
                            Следующий этап
                          </Link>
                        ) : (
                          <Link className="btn dark" to="/topics">
                            К каталогу тем
                          </Link>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : null}
                {verdict.kind === "fail" ? (
                  <>
                    <strong>{verdict.message}</strong>
                    {verdict.detail ? <pre>{verdict.detail}</pre> : null}
                  </>
                ) : null}
                {verdict.kind === "self" ? (
                  <>
                    <strong>Самопроверка.</strong> Сравните своё решение с
                    эталоном:
                    <pre>{verdict.answer}</pre>
                    <div>
                      <InlineHtml source={verdict.explanation} />
                    </div>
                    <div className="self-actions">
                      <button
                        className="btn dark"
                        type="button"
                        disabled={busy}
                        onClick={() => void onSelfOk()}
                      >
                        Совпало — засчитать +{points} XP
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setVerdict({ kind: "idle" })}
                      >
                        Ещё подумаю
                      </button>
                    </div>
                  </>
                ) : null}
              </div>

              {(reviewPending || reviewText) && (
                <div className="review-box show" id="reviewBox">
                  {reviewText ? (
                    <SafeMarkdown source={reviewText} />
                  ) : (
                    <span className="review-wait">
                      <span className="thinking-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>✎ наставник смотрит вашу попытку…</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <HintsPane task={task} />
          <NotesPane taskId={task.id} />
        </div>

        <CourseRail task={task} solved={solvedIds} repository={repository} />
      </div>

      <SuccessModal
        open={successOpen}
        points={points}
        nextId={nextId && !task.challenge ? nextId : null}
        reviewText={reviewText}
        reviewPending={reviewPending}
        onClose={closeSuccess}
      />
    </div>
  );
}
