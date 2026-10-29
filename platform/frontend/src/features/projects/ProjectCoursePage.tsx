import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fetchProjectCourse,
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
  busy,
}: {
  course: ProjectCourse;
  onStart: () => void;
  busy: boolean;
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
        disabled={busy}
        onClick={onStart}
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
  return null;
}

/**
 * Legacy `#/project/:course` — hero + stage rail.
 */
export function ProjectCoursePage() {
  const { course: courseId = "" } = useParams<{ course: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<ProjectCourse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCourse(null);
    setError(null);
    (async () => {
      try {
        const data = await fetchProjectCourse(courseId);
        if (!cancelled) setCourse(data.course);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  async function onStart() {
    setBusy(true);
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
      else setCourse(data.course);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  if (error && !course) {
    return (
      <div className="task-page project-page">
        <div className="empty">
          <h2>Не удалось открыть курс</h2>
          <p>{error}</p>
          <Link className="btn dark" to="/projects">
            К квестам
          </Link>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="task-page project-page">
        <div className="empty">Загружаю курс...</div>
      </div>
    );
  }

  const stages = course.stages || [];

  return (
    <div className="task-page project-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / <Link to="/projects">Квесты</Link> /{" "}
          {course.short_title}
        </div>
        <Link className="btn" to="/projects">
          Все квесты
        </Link>
      </div>
      <section className={`pane project-detail-hero ${accentClass(course)}`}>
        <div className="project-detail-top">
          <Emblem course={course} size="lg" />
          <div>
            <QuestMeta course={course} />
            <span className={statusClass(course.status)}>
              {course.status_label}
            </span>
            <h2>{course.title}</h2>
          </div>
        </div>
        <p>{course.intro || course.description}</p>
        <div className="project-progress-bar">
          <span style={{ width: `${course.progress_percent}%` }} />
        </div>
        <p className="project-final">
          <b>Награда квеста:</b> {course.final_result}
        </p>
        <div className="project-card-actions">
          <CourseActions course={course} onStart={onStart} busy={busy} />
        </div>
      </section>
      <section className="pane">
        <h3>Главы квеста</h3>
        <div className="project-stage-list">
          {stages.map((stage, i) => {
            const locked =
              stage.status === "unavailable" || stage.status === "waiting";
            const href = locked
              ? `/project/${course.id}`
              : `/project/${course.id}/${stage.id}`;
            const done = stage.status === "completed";
            return (
              <Link
                key={stage.id}
                className={`project-stage-row ${stage.status}`}
                to={href}
              >
                <span
                  className={`project-stage-num${done ? " done" : ""}`}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="project-stage-main">
                  <small className="project-stage-chapter">
                    Глава {i + 1} из {stages.length}
                  </small>
                  <b>{stage.title}</b>
                  <small>{stage.new_knowledge || stage.status_label}</small>
                </span>
                <span className={statusClass(stage.status)}>
                  {stage.status_label}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
