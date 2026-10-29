import type { ProjectCourse } from "../../services/projectCourses";

const COURSE_MARK: Record<string, string> = {
  chatbot_to_telegram: "{ }",
  text_analyzer: "Aa",
  habit_tracker: "···",
  generative_poster: "#",
  python_game: "<>",
};

export function courseMark(course: { id?: string; emblem?: string }): string {
  if (course.id && COURSE_MARK[course.id]) return COURSE_MARK[course.id];
  return "·";
}

export function accentClass(course: { accent?: string }): string {
  return `project-accent-${course.accent || "cyan"}`;
}

export function statusClass(status: string | undefined): string {
  return `project-status project-status-${status || "unknown"}`;
}

export function Emblem({
  course,
  size = "",
}: {
  course: { id?: string; emblem?: string };
  size?: "" | "sm" | "lg";
}) {
  const sizeCls = size ? ` project-emblem-${size}` : "";
  return (
    <div
      className={`project-emblem project-emblem-${course.emblem || "bot"}${sizeCls}`}
      aria-hidden="true"
    >
      <span>{courseMark(course)}</span>
    </div>
  );
}

export function QuestMeta({ course }: { course: ProjectCourse }) {
  return (
    <div className="project-quest-meta">
      <span className="project-track-order">
        {course.track_order}/{course.track_total}
      </span>
      <span className="project-quest-tag">{course.quest_label}</span>
    </div>
  );
}

export function snapshotKindLabel(kind: string): string {
  return (
    {
      start: "старт",
      save: "сохранение",
      complete: "завершение",
      restore: "восстановление",
    }[kind] || kind
  );
}

/** Convert legacy hash href `#/project/...` to React Router path. */
export function hashToPath(href: string): string {
  if (href.startsWith("#")) return href.slice(1) || "/";
  return href;
}
