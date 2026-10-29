import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchProjectCourses,
  startProjectCourse,
  type ProjectCourse,
} from "../../services/projectCourses";
import {
  Emblem,
  QuestMeta,
  accentClass,
  statusClass,
} from "./projectUi";

function CourseActions({
  course,
  onStart,
  starting,
}: {
  course: ProjectCourse;
  onStart: (id: string) => void;
  starting: string | null;
}) {
  if (course.status === "unavailable") {
    const topics =
      course.unlock_topic_titles.length > 0
        ? course.unlock_topic_titles
        : course.next_stage?.required_topic_titles || [];
    return (
      <span className="project-lock">
        Откроется после: {topics.join(", ") || "нескольких тем"}
      </span>
    );
  }
  if (course.status === "available") {
    return (
      <button
        type="button"
        className="btn dark project-start"
        disabled={starting === course.id}
        onClick={() => onStart(course.id)}
      >
        Начать квест
      </button>
    );
  }
  if (course.status === "completed") {
    return (
      <Link className="btn" to={`/project/${course.id}`}>
        Открыть завершённый
      </Link>
    );
  }
  if (course.next_stage) {
    return (
      <Link
        className="btn dark"
        to={`/project/${course.id}/${course.next_stage.id}`}
      >
        Продолжить
      </Link>
    );
  }
  return (
    <Link className="btn" to={`/project/${course.id}`}>
      Открыть
    </Link>
  );
}

/**
 * Legacy `#/projects` — epic carousel of quest tracks.
 */
export function ProjectsPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<ProjectCourse[]>([]);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProjectCourses();
        if (cancelled) return;
        const list = data.courses;
        setCourses(list);
        let next = Math.max(
          0,
          list.findIndex(
            (c) => c.status === "started" || c.status === "continue",
          ),
        );
        if (next < 0) {
          next = Math.max(
            0,
            list.findIndex((c) => c.status === "available"),
          );
        }
        if (next < 0) next = 0;
        setIdx(next);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback(
    (next: number) => {
      if (!courses.length) return;
      setIdx((next + courses.length) % courses.length);
    },
    [courses.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(idx - 1);
      if (e.key === "ArrowRight") go(idx + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx]);

  // Legacy touch-swipe on epic carousel track.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || courses.length < 2) return;
    let touchX: number | null = null;
    const onStart = (e: TouchEvent) => {
      touchX = e.changedTouches[0]?.clientX ?? null;
    };
    const onEnd = (e: TouchEvent) => {
      if (touchX == null) return;
      const x = e.changedTouches[0]?.clientX;
      if (x == null) {
        touchX = null;
        return;
      }
      const dx = x - touchX;
      touchX = null;
      if (Math.abs(dx) < 48) return;
      go(idx + (dx < 0 ? 1 : -1));
    };
    track.addEventListener("touchstart", onStart, { passive: true });
    track.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      track.removeEventListener("touchstart", onStart);
      track.removeEventListener("touchend", onEnd);
    };
  }, [courses.length, go, idx]);

  async function onStart(courseId: string) {
    setStarting(courseId);
    try {
      const data = await startProjectCourse(courseId);
      const stages = data.course.stages || [];
      const first = stages.find(
        (s) =>
          s.status === "started" ||
          s.status === "continue" ||
          s.status === "available",
      );
      if (first) navigate(`/project/${courseId}/${first.id}`);
      else navigate(`/project/${courseId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setStarting(null);
    }
  }

  if (loading) {
    return (
      <div className="task-page project-page">
        <div className="empty">Загружаю проекты...</div>
      </div>
    );
  }

  if (error && !courses.length) {
    return (
      <div className="task-page project-page">
        <div className="empty">
          <h2>Не удалось открыть проектные курсы</h2>
          <p>{error}</p>
          <Link className="btn dark" to="/">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  const current = courses[idx];
  const accent = current?.accent || "cyan";

  return (
    <div
      className="task-page project-page project-epic"
      data-accent={accent}
    >
      <div className="project-epic-bg" aria-hidden="true" />
      <div className="task-nav project-epic-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / Квесты
        </div>
        <Link className="btn" to="/showcase">
          Доска работ
        </Link>
      </div>
      {error ? <p className="stat-note">{error}</p> : null}
      <div className="project-epic-stage">
        <button
          type="button"
          className="project-epic-arrow prev"
          aria-label="Предыдущий квест"
          disabled={courses.length < 2}
          onClick={() => go(idx - 1)}
        >
          ‹
        </button>
        <div className="project-epic-viewport">
          <div
            ref={trackRef}
            className="project-epic-track"
            style={{ transform: `translateX(-${idx * 100}%)` }}
          >
            {courses.map((course, i) => {
              const pct = course.progress_percent || 0;
              const unlock = course.unlock_topic_titles || [];
              return (
                <article
                  key={course.id}
                  className={`project-epic-slide ${accentClass(course)}${
                    i === idx ? " is-active" : ""
                  }`}
                  data-index={i}
                  aria-hidden={i === idx ? "false" : "true"}
                >
                  <div className="project-epic-glow" aria-hidden="true" />
                  <div className="project-epic-panel pane">
                    <div className="project-epic-top">
                      <Emblem course={course} size="lg" />
                      <div>
                        <QuestMeta course={course} />
                        <span className={statusClass(course.status)}>
                          {course.status_label}
                        </span>
                      </div>
                    </div>
                    <p className="project-epic-kicker">
                      Квест {course.track_order || i + 1} из{" "}
                      {course.track_total || courses.length}
                    </p>
                    <h2 className="project-epic-title">{course.title}</h2>
                    <p className="project-epic-desc">
                      {course.intro || course.description}
                    </p>
                    <div
                      className="project-progress-bar"
                      aria-label="Прогресс квеста"
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <p className="project-progress-caption">
                      {pct
                        ? `${course.completed_stages} из ${course.total_stages} глав · ${pct}%`
                        : unlock.length
                          ? `Старт после темы «${unlock[unlock.length - 1]}»`
                          : "Готов к старту"}
                    </p>
                    <p className="project-epic-reward">
                      <b>Награда:</b> {course.final_result}
                    </p>
                    <div className="project-card-actions">
                      <CourseActions
                        course={course}
                        onStart={onStart}
                        starting={starting}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="project-epic-arrow next"
          aria-label="Следующий квест"
          disabled={courses.length < 2}
          onClick={() => go(idx + 1)}
        >
          ›
        </button>
      </div>
      <div
        className="project-epic-dots"
        role="tablist"
        aria-label="Квесты"
      >
        {courses.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`project-epic-dot ${i === idx ? "active" : ""} ${accentClass(c)}`}
            role="tab"
            aria-selected={i === idx}
            aria-label={c.short_title || c.title}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </div>
  );
}
