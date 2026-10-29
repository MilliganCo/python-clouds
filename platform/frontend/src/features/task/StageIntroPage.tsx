import { useState } from "react";
import { Link } from "react-router-dom";
import { SafeMarkdown } from "../../components/SafeMarkdown/SafeMarkdown";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import {
  HINT_BY_TYPE,
  TYPE_STAGE,
  stageRouteLine,
} from "../../content/stageLessons";
import { apiPost } from "../../services/api";
import { sanitizeCourseHtml } from "../../services/legacyContent";
import { pointsFor } from "../../services/rankProgress";
import type {
  TaskPageModel,
  TheoryArticleModel,
} from "../../types/content";
import { TheoryArticleBody } from "../theory/TheoryArticleBody";
import { inlineCourseText } from "./inlineCourseText";

type PrevTopic = {
  id: number;
  title: string;
  taskIds: string[];
};

type Props = {
  task: TaskPageModel;
  article: TheoryArticleModel;
  topicTaskIds: string[];
  prevTopics: PrevTopic[];
  solved: ReadonlySet<string>;
  onBegin: () => void;
};

function InlineHtml({ source }: { source: string }) {
  const html = sanitizeCourseHtml(inlineCourseText(source));
  return <TrustedCourseContent html={html} as="span" />;
}

function resolveIntro(task: TaskPageModel) {
  const hasCustom = !!(task.intro.goal || task.intro.explanation);
  if (hasCustom) return task.intro;
  const typeHint =
    HINT_BY_TYPE[task.type] ||
    "Прочитайте условие и код внимательно перед тем, как отвечать.";
  const typeText = TYPE_STAGE[task.type] || "";
  return {
    goal: typeHint,
    concepts: [] as string[],
    explanation: typeText || typeHint,
    text: typeHint,
    example: null as string | null,
    application: "",
    html: false,
  };
}

/**
 * Legacy stage intro before first attempt on an unsolved non-challenge task.
 */
export function StageIntroPage({
  task,
  article,
  topicTaskIds,
  prevTopics,
  solved,
  onBegin,
}: Props) {
  const intro = resolveIntro(task);
  const stageIdx = Math.max(0, topicTaskIds.indexOf(task.id));
  const total = topicTaskIds.length || 1;
  const stageNum = stageIdx + 1;
  const points = pointsFor({
    level: task.topicLevel,
    challenge: task.challenge,
  });
  const routeLine = stageRouteLine(task.topicId, stageIdx);
  const showFullTheory = stageIdx === 0;
  const [lessonHtml, setLessonHtml] = useState<string | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);

  async function loadLesson() {
    setLessonBusy(true);
    setLessonOpen(true);
    try {
      const r = await apiPost(
        "/api/ai/lesson",
        {
          task: { id: task.id, type: task.type, prompt: task.prompt },
          theory: {
            topic: task.topicTitle,
            text: article.leadHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            example: article.exampleCode || "",
          },
        },
        (v) => {
          if (typeof v !== "object" || v === null) return { lesson: null };
          const lesson = (v as { lesson?: unknown }).lesson;
          return {
            lesson: typeof lesson === "string" ? lesson : null,
          };
        },
      );
      setLessonHtml(
        r.lesson ||
          "ИИ-наставник сейчас недоступен — теории выше достаточно для этапа.",
      );
    } catch (e) {
      setLessonHtml(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLessonBusy(false);
    }
  }

  const goalHtml = intro.html
    ? sanitizeCourseHtml(intro.goal)
    : sanitizeCourseHtml(inlineCourseText(intro.goal));
  const bodyHtml = intro.html
    ? sanitizeCourseHtml(intro.explanation)
    : sanitizeCourseHtml(inlineCourseText(intro.explanation));
  const appHtml = intro.html
    ? sanitizeCourseHtml(intro.application)
    : sanitizeCourseHtml(inlineCourseText(intro.application));

  return (
    <div className="task-page stage-intro-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/topics">Темы</Link> /{" "}
          <InlineHtml source={task.topicTitle} />
        </div>
        <span className={`level-badge lv-${task.topicLevel}`}>
          {task.topicLevelLabel}
        </span>
      </div>

      <div className="stage-hero pane">
        <p className="stage-eyebrow">
          Тема {task.topicId} · этап {stageNum} из {total} · +{points} XP
        </p>
        <h1 className="stage-title">
          {task.title ? (
            <InlineHtml source={task.title} />
          ) : (
            <InlineHtml source={task.topicTitle} />
          )}
        </h1>
        <div className="stage-route">
          {topicTaskIds.map((tid, i) => {
            const cls = solved.has(tid)
              ? "done"
              : i === stageIdx
                ? "current"
                : "";
            return (
              <span
                key={tid}
                className={`route-dot ${cls}`}
                title={`Этап ${i + 1}`}
              />
            );
          })}
        </div>
        {routeLine ? <p className="stage-route-line">{routeLine}</p> : null}
      </div>

      <div className="stage-grid">
        <div className="pane stage-goal">
          <h3>
            <span className="nf nf-school" aria-hidden="true" /> Что тренирует
            этот этап
          </h3>
          {intro.goal ? (
            <p className="stage-goal-lead">
              <b>Цель.</b>{" "}
              <TrustedCourseContent html={goalHtml} as="span" />
            </p>
          ) : null}
          {intro.concepts.length ? (
            <p className="stage-concepts">
              {intro.concepts.map((c, i) => (
                <span key={c}>
                  {i > 0 ? " · " : null}
                  <code>{c}</code>
                </span>
              ))}
            </p>
          ) : null}
          {intro.explanation ? (
            <div className="stage-goal-text">
              <TrustedCourseContent html={bodyHtml} as="div" />
            </div>
          ) : null}
          {intro.example ? (
            <div className="terminal-glass readonly">
              <div className="terminal-label-bar">
                <span className="terminal-title">пример.py</span>
              </div>
              <pre className="terminal-body">
                <code>{intro.example}</code>
              </pre>
            </div>
          ) : null}
          {intro.application ? (
            <p className="stage-apply">
              <b>Где пригодится.</b>{" "}
              <TrustedCourseContent html={appHtml} as="span" />
            </p>
          ) : null}
          {TYPE_STAGE[task.type] ? (
            <details className="stage-format">
              <summary>Формат задания · {task.type}</summary>
              <p>{TYPE_STAGE[task.type]}</p>
            </details>
          ) : null}
        </div>

        <div className="stage-side">
          <div className="pane">
            <h3>Вы уже прошли</h3>
            <div className="stage-prev-list">
              {prevTopics.length ? (
                prevTopics.map((t) => {
                  const allDone = t.taskIds.every((id) => solved.has(id));
                  return (
                    <div key={t.id} className={allDone ? "done" : ""}>
                      {t.title}
                      {allDone ? " ✓" : ""}
                    </div>
                  );
                })
              ) : (
                <p className="stat-note">Это ваша первая тема — отличный старт.</p>
              )}
            </div>
          </div>
          {!showFullTheory ? (
            <div className="pane stage-theory-mini">
              <h3>
                <span className="nf nf-book" aria-hidden="true" /> Теория темы
              </h3>
              <p className="stage-goal-text">
                Кратко: {article.teaserHtml.replace(/<[^>]+>/g, "").slice(0, 180)}
                …
              </p>
              <div className="theory-teaser-actions">
                <Link className="btn" to={`/topic/${task.topicId}/theory`}>
                  Читать теорию темы полностью
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {showFullTheory ? (
        <div className="stage-theory-full">
          <h2 className="stage-theory-full-head">
            <span className="nf nf-book" aria-hidden="true" /> Теория темы —
            начинаем с полного разбора
          </h2>
          <TheoryArticleBody article={article} showCta={false} />
          <div className="theory-teaser-actions">
            <Link className="btn" to={`/topic/${task.topicId}/theory`}>
              Читать теорию темы полностью
            </Link>
          </div>
        </div>
      ) : null}

      <div className="pane stage-more">
        <div className="stage-more-head">
          <h3>Хотите глубже?</h3>
          <button
            type="button"
            className="btn"
            disabled={lessonBusy}
            onClick={() => void loadLesson()}
          >
            <span className="nf nf-lightbulb" aria-hidden="true" /> Узнать
            подробнее
          </button>
        </div>
        {lessonOpen ? (
          <div className="stage-lesson" id="lessonBox">
            {lessonBusy && !lessonHtml ? (
              <span className="review-wait">
                ✎ наставник готовит разбор этапа…
              </span>
            ) : lessonHtml ? (
              <SafeMarkdown source={lessonHtml} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="stage-cta">
        <button type="button" className="btn dark big" onClick={onBegin}>
          Перейти к заданию →
        </button>
        <Link className="link-btn" to="/topics">
          вернуться к темам
        </Link>
      </div>
    </div>
  );
}
